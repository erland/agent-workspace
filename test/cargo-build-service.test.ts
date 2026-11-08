import assert from "node:assert/strict";
import test from "node:test";
import type { Command, SandboxProvider, WorkspaceHandle, CreateWorkspaceOptions, ExecutionResult } from "../src/core/sandbox-provider.js";
import { ProjectBuildService } from "../src/artifact/project-build-service.js";
const handle={providerId:"fake",providerWorkspaceId:"cargo"};
class Provider implements SandboxProvider {
 commands:Command[]=[]; reads:string[]=[];
 probe=0; fail=""; binaries=["demo-cli","helper"]; metadataInvalid=false;
 async createWorkspace(_o:CreateWorkspaceOptions):Promise<WorkspaceHandle>{return handle;}
 async uploadArchive():Promise<void>{}
 async terminate():Promise<void>{}
 async readFile(_h:WorkspaceHandle,path:string):Promise<Uint8Array>{this.reads.push(path);return Uint8Array.of(127,69,76,70);}
 async exec(_h:WorkspaceHandle,c:Command):Promise<ExecutionResult>{
  this.commands.push(c);
  if(c.argv[0]==="bash" && c.argv[2]?.includes("test -f Cargo.toml"))return {exitCode:this.probe,stdout:"",stderr:""};
  if(c.argv[0]==="cargo"&&c.argv[1]===this.fail)return {exitCode:2,stdout:"",stderr:"cargo failed"};
  if(c.argv[0]==="cargo"&&c.argv[1]==="metadata")return {exitCode:0,stdout:this.metadataInvalid?"BAD":JSON.stringify({
   workspace_members:["p1"],
   packages:[{id:"p1",targets:this.binaries.map(name=>({name,kind:["bin"]}))},{id:"ignored",targets:[{name:"ignored",kind:["bin"]}]}]
  }),stderr:""};
  if(c.argv[0]==="bash"&&c.argv[2]?.includes("elif [ -d"))return {exitCode:0,stdout:"file",stderr:""};
  if(c.argv[0]==="stat")return {exitCode:0,stdout:"4",stderr:""};
  return {exitCode:0,stdout:"",stderr:""};
 }
}
test("publishes executable Linux binaries from Cargo workspace members",async()=>{
 const p=new Provider();
 const r=await new ProjectBuildService(p,"/workspace/project").build(handle,"CARGO");
 assert.equal(r.status,"PASSED");assert.equal(r.projectType,"CARGO");
 assert.deepEqual(r.outputs.map(x=>[x.kind,x.filename,x.mediaType]),[
  ["linux-binary","demo-cli","application/octet-stream"],["linux-binary","helper","application/octet-stream"]
 ]);
 assert.deepEqual(p.reads,["/workspace/project/target/release/demo-cli","/workspace/project/target/release/helper"]);
 assert.ok(p.commands.some(c=>c.argv.join(" ")==="cargo clean --release"));
 assert.ok(p.commands.some(c=>c.argv.join(" ")==="cargo build --release --workspace"));
});
test("library-only projects need explicit output; no invented executable",async()=>{
 const p=new Provider();p.binaries=[];
 await assert.rejects(()=>new ProjectBuildService(p,"/workspace/project").build(handle,"CARGO"),/no binary targets/);
});
test("failing or unsupported Cargo builds do not publish artifacts",async()=>{
 for(const choice of ["probe","build","metadata"]){
  const p=new Provider();if(choice==="probe")p.probe=1;if(choice==="build")p.fail="build";if(choice==="metadata")p.metadataInvalid=true;
  await assert.rejects(()=>new ProjectBuildService(p,"/workspace/project").build(handle,"CARGO"));
  assert.equal(p.reads.length,0);
 }
});
test("explicit Cargo output validated and published unchanged",async()=>{
 const p=new Provider();
 const build=new ProjectBuildService(p,"/workspace/project");
 const r=await build.build(handle,"CARGO",[{path:"target/release/demo-cli"}]);
 assert.equal(r.outputs[0]?.filename,"demo-cli");
 await assert.rejects(()=>build.build(handle,"CARGO",[{path:"../secret"}]),/Invalid build output path/);
});
