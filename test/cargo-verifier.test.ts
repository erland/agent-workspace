import assert from "node:assert/strict";
import test from "node:test";
import type { Command, SandboxProvider, WorkspaceHandle, CreateWorkspaceOptions, ExecutionResult } from "../src/core/sandbox-provider.js";
import { CargoVerifier } from "../src/verification/cargo-verifier.js";
const handle={providerId:"fake",providerWorkspaceId:"cargo"};
class Provider implements SandboxProvider {
  commands:Command[]=[];
  probe=0;
  failed="";
  tests=2;
  async createWorkspace(_o:CreateWorkspaceOptions):Promise<WorkspaceHandle>{return handle;}
  async uploadArchive():Promise<void>{}
  async terminate():Promise<void>{}
  async readFile():Promise<Uint8Array>{return new Uint8Array();}
  async exec(_h:WorkspaceHandle,c:Command):Promise<ExecutionResult>{
    this.commands.push(c);
    if(c.argv[0]==="bash")return {exitCode:this.probe,stdout:"",stderr:""};
    const name=c.argv[1]??"";
    if(name===this.failed)return {exitCode:7,stdout:"",stderr:"Cargo step failed"};
    return {exitCode:0,stdout:name==="test"?`running ${this.tests} tests\ntest result: ok`:"OK",stderr:""};
  }
}
test("Cargo checks formatting, compiles, lints and confirms executed workspace tests",async()=>{
 const p=new Provider();
 const r=await new CargoVerifier(p,{projectRoot:"/workspace/project/rust"}).verify(handle);
 assert.equal(r.status,"PASSED"); assert.equal(r.projectType,"CARGO");
 assert.deepEqual(r.steps.map(x=>x.name),["format","check","clippy","test"]);
 assert.ok(p.commands.every(c=>c.workdir==="/workspace/project/rust"));
 assert.deepEqual(p.commands[3]?.argv,["cargo","clippy","--workspace","--all-targets","--","-D","warnings"]);
});
test("missing manifest or rust-toolchain override blocks verification",async()=>{
 const p=new Provider();p.probe=1;
 const r=await new CargoVerifier(p).verify(handle);
 assert.equal(r.status,"BLOCKED");assert.match(r.failureSummary??"",/rust-toolchain/);
 assert.equal(p.commands.length,1);
});
test("failed format/check/clippy/test cannot be reported as PASSED",async()=>{
 for(const name of ["fmt","check","clippy","test"]){
  const p=new Provider();p.failed=name;
  const r=await new CargoVerifier(p).verify(handle);
  assert.equal(r.status,"FAILED");assert.equal(r.exitCode,7);
 }
});
test("no executed Rust tests returns BLOCKED",async()=>{
 const p=new Provider();p.tests=0;
 const r=await new CargoVerifier(p).verify(handle);
 assert.equal(r.status,"BLOCKED");assert.match(r.failureSummary??"",/no executed tests/);
});
