import assert from "node:assert/strict";
import test from "node:test";
import type { Command, SandboxProvider, WorkspaceHandle, CreateWorkspaceOptions, ExecutionResult } from "../src/core/sandbox-provider.js";
import { GradleVerifier } from "../src/verification/gradle-verifier.js";

const handle = {providerId:"fake",providerWorkspaceId:"one"};
class GradleProvider implements SandboxProvider {
  commands: Command[] = [];
  wrapper = true;
  testExit = 0;
  async createWorkspace(_o:CreateWorkspaceOptions):Promise<WorkspaceHandle>{return handle;}
  async uploadArchive():Promise<void>{}
  async terminate():Promise<void>{}
  async readFile():Promise<Uint8Array>{return new Uint8Array();}
  async exec(_h:WorkspaceHandle,c:Command):Promise<ExecutionResult>{
    this.commands.push(c);
    if(c.argv[0]==="bash" && c.argv[1]==="-lc")return {exitCode:this.wrapper?0:1,stdout:"",stderr:""};
    return {exitCode:this.testExit,stdout:this.testExit?"":"BUILD SUCCESSFUL",stderr:this.testExit?"FAILURE: test failed":""};
  }
}
test("runs wrapper test in selected project root",async()=>{
  const p=new GradleProvider();
  const r=await new GradleVerifier(p,{projectRoot:"/workspace/project/backend"}).verify(handle);
  assert.equal(r.status,"PASSED");
  assert.equal(r.projectType,"GRADLE");
  assert.equal(r.steps[0]?.name,"test");
  assert.deepEqual(p.commands[1]?.argv,["bash","./gradlew","--no-daemon","--console=plain","test"]);
  assert.ok(p.commands.every(c=>c.workdir==="/workspace/project/backend"));
});
test("wrapper is required and missing wrapper is BLOCKED",async()=>{
  const p=new GradleProvider();p.wrapper=false;
  const r=await new GradleVerifier(p).verify(handle);
  assert.equal(r.status,"BLOCKED");
  assert.match(r.failureSummary??"",/Gradle Wrapper/);
  assert.equal(p.commands.length,1);
});
test("failed Gradle tests return FAILED and preserve diagnostic steps",async()=>{
  const p=new GradleProvider();p.testExit=1;
  const r=await new GradleVerifier(p).verify(handle);
  assert.equal(r.status,"FAILED");
  assert.equal(r.failedStep,"test");
  assert.equal(r.exitCode,1);
  assert.match(r.failureSummary??"",/FAILURE|test failed/);
});
