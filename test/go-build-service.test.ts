import assert from "node:assert/strict";
import test from "node:test";
import type { Command, CreateWorkspaceOptions, ExecutionResult, SandboxProvider, WorkspaceHandle } from "../src/core/sandbox-provider.js";
import { ProjectBuildService } from "../src/artifact/project-build-service.js";

const handle: WorkspaceHandle = {providerId:"fake",providerWorkspaceId:"go-build"};
const ok = (stdout = ""): ExecutionResult => ({exitCode:0,stdout,stderr:""});

class GoBuildProvider implements SandboxProvider {
  commands: Command[] = [];
  reads: string[] = [];
  probe = "module";
  modules: string[] = ["./server","./worker"];
  packages = ["example.com/acme/cmd/server","example.com/acme/cmd/worker"];
  failAt = "";
  outputSize = 4;
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {return handle;}
  async uploadArchive(): Promise<void> {}
  async terminate(): Promise<void> {}
  async readFile(_handle:WorkspaceHandle,p:string):Promise<Uint8Array>{this.reads.push(p);return Uint8Array.of(127,69,76,70);}
  async exec(_handle:WorkspaceHandle,c:Command):Promise<ExecutionResult>{
    this.commands.push(c);
    const argv = c.argv;
    let name = argv[0] === "stat" ? "stat"
      : argv[0] === "go" && argv.includes("work") ? "work"
      : argv[0] === "go" && argv.includes("list") ? "list"
      : argv[0] === "go" && argv.includes("build") ? "build"
      : argv[0] === "go" && argv.includes("download") ? "dependencies"
      : argv[0] === "bash" && argv[2]?.includes("if [ -f go.work ]") ? "probe"
      : argv[0] === "bash" && argv[2]?.includes("mkdir -m 700") ? "prepare"
      : argv[0] === "bash" && argv[2]?.includes("elif [ -d") ? "inspect"
      : "other";
    if (name === this.failAt) return {exitCode:2,stdout:"",stderr:"forced failure"};
    if (name === "probe") return ok(this.probe);
    if (name === "work") return ok(JSON.stringify({Use:this.modules.map(DiskPath=>({DiskPath}))}));
    if (name === "list") return ok(this.packages.join("\n")+"\n");
    if (name === "inspect") return ok("file");
    if (name === "stat") return ok(String(this.outputSize));
    return ok();
  }
}

test("GO-003 builds and publishes two Linux binaries without a separate output handler",async()=>{
 const provider=new GoBuildProvider();
 const r=await new ProjectBuildService(provider,"/workspace/project").build(handle,"GO");
 assert.equal(r.status,"PASSED");
 assert.equal(r.projectType,"GO");
 assert.deepEqual(r.outputs.map(x=>[x.filename,x.kind,x.mediaType]),[
  ["server","linux-binary","application/octet-stream"],
  ["worker","linux-binary","application/octet-stream"]
 ]);
 assert.deepEqual(provider.reads,[
  "/workspace/project/.agent-workspace-go-bin/server",
  "/workspace/project/.agent-workspace-go-bin/worker"
 ]);
 assert.equal(provider.commands.filter(c=>c.argv.includes("build")).length,2);
 assert.ok(provider.commands.some(c=>c.argv[0]==="go"&&c.argv.includes("list")));
 assert.ok(provider.commands.some(c=>c.argv[0]==="bash"&&c.argv[2]?.includes("rm -rf -- .agent-workspace-go-bin")));
});
test("GO-003 rejects library-only projects rather than publishing stale files",async()=>{
 const provider=new GoBuildProvider();provider.packages=[];
 await assert.rejects(()=>new ProjectBuildService(provider,"/workspace/project").build(handle,"GO"),/no executable main packages/);
 assert.equal(provider.reads.length,0);
});
test("GO-003 failures and oversized output never publish files",async()=>{
 for(const failAt of ["probe","prepare","dependencies","list","build","inspect"]){
  const provider=new GoBuildProvider();provider.failAt=failAt;
  await assert.rejects(()=>new ProjectBuildService(provider,"/workspace/project").build(handle,"GO"),failAt==="probe"?/go.mod or go.work/:/forced failure|Command failed|Could not inspect|does not exist/);
  assert.equal(provider.reads.length,0);
 }
 const tooLarge=new GoBuildProvider();tooLarge.outputSize=4096;
 await assert.rejects(()=>new ProjectBuildService(tooLarge,"/workspace/project",1024).build(handle,"GO"),/exceeds maximum/);
 assert.equal(tooLarge.reads.length,0);
});
test("GO-003 handles go.work modules with module-specific go -C without escaping workspace",async()=>{
 const provider=new GoBuildProvider();provider.probe="workspace";provider.packages=["example.com/service"];
 const result=await new ProjectBuildService(provider,"/workspace/project").build(handle,"GO");
 assert.equal(result.status,"PASSED");
 assert.equal(result.outputs.length,2);
 assert.ok(provider.commands.some(c=>c.argv[0]==="go"&&c.argv.includes("/workspace/project/server")));
 assert.ok(provider.commands.some(c=>c.argv[0]==="go"&&c.argv.includes("/workspace/project/worker")));
 assert.deepEqual(result.outputs.map(x=>x.filename),["service","service-2"]);
});
test("GO-003 blocks malicious module paths and never builds out of sandbox root",async()=>{
 for(const malicious of ["../outside","/etc"]){
  const provider=new GoBuildProvider();provider.probe="workspace";provider.modules=[malicious];
  await assert.rejects(()=>new ProjectBuildService(provider,"/workspace/project").build(handle,"GO"),/escapes uploaded project/);
  assert.equal(provider.commands.filter(c=>c.argv.includes("build")).length,0);
 }
});
test("GO-003 validates user-selected artifact output paths and enforces limit",async()=>{
 const provider=new GoBuildProvider();
 await assert.rejects(()=>new ProjectBuildService(provider,"/workspace/project").build(handle,"GO",[{path:"../secret"}]),/Invalid build output path/);
 await assert.rejects(()=>new ProjectBuildService(provider,"/workspace/project").build(handle,"GO",Array.from({length:13},(_,i)=>({path:"x"+i}))),/more than 12/);
});
