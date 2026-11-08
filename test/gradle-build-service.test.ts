import assert from "node:assert/strict";
import test from "node:test";
import type { Command, SandboxProvider, WorkspaceHandle, CreateWorkspaceOptions, ExecutionResult } from "../src/core/sandbox-provider.js";
import { ProjectBuildService } from "../src/artifact/project-build-service.js";

const handle={providerId:"fake",providerWorkspaceId:"gradle"};
class BuildProvider implements SandboxProvider {
  commands:Command[]=[];
  reads:string[]=[];
  wrapper=true;
  buildOk=true;
  outputPaths="./build/libs/demo-1.0.jar\n./web/build/libs/website.war\n";
  async createWorkspace(_o:CreateWorkspaceOptions):Promise<WorkspaceHandle>{return handle;}
  async uploadArchive():Promise<void>{}
  async terminate():Promise<void>{}
  async readFile(_h:WorkspaceHandle,path:string):Promise<Uint8Array>{this.reads.push(path);return Uint8Array.of(80,75,3,4);}
  async exec(_h:WorkspaceHandle,c:Command):Promise<ExecutionResult>{
    this.commands.push(c);
    const argv=c.argv.join(" ");
    if(argv.includes("test -f ./gradlew"))return{exitCode:this.wrapper?0:1,stdout:"",stderr:""};
    if(argv.includes("--console=plain assemble"))return{exitCode:this.buildOk?0:1,stdout:"",stderr:this.buildOk?"":"Gradle build failed"};
    if(argv.includes("find . -type f"))return{exitCode:0,stdout:this.outputPaths,stderr:""};
    if(argv.includes("if [ -f")&&argv.includes("elif [ -d"))return{exitCode:0,stdout:"file",stderr:""};
    if(c.argv[0]==="stat")return{exitCode:0,stdout:"4",stderr:""};
    return{exitCode:0,stdout:"",stderr:""};
  }
}
test("Gradle assemble publishes JAR and WAR from subprojects",async()=>{
 const p=new BuildProvider();
 const r=await new ProjectBuildService(p,"/workspace/project").build(handle,"GRADLE");
 assert.equal(r.status,"PASSED");
 assert.equal(r.projectType,"GRADLE");
 assert.deepEqual(r.outputs.map(x=>[x.kind,x.filename,x.mediaType]),[
  ["jar","demo-1.0.jar","application/java-archive"],["war","website.war","application/java-archive"]
 ]);
 assert.deepEqual(p.reads,["/workspace/project/build/libs/demo-1.0.jar","/workspace/project/web/build/libs/website.war"]);
 assert.ok(p.commands.some(c=>c.argv.join(" ")==="bash ./gradlew --no-daemon --console=plain assemble"));
});
test("missing Gradle Wrapper blocks packaging before execution",async()=>{
 const p=new BuildProvider();p.wrapper=false;
 await assert.rejects(()=>new ProjectBuildService(p,"/workspace/project").build(handle,"GRADLE"),/Gradle Wrapper/);
 assert.equal(p.reads.length,0);
});
test("Gradle failing build never publishes artifacts",async()=>{
 const p=new BuildProvider();p.buildOk=false;
 await assert.rejects(()=>new ProjectBuildService(p,"/workspace/project").build(handle,"GRADLE"),/Gradle build failed/);
 assert.equal(p.reads.length,0);
});
test("Gradle successful assemble with no jar/war must not return PASSED",async()=>{
 const p=new BuildProvider();p.outputPaths="";
 await assert.rejects(()=>new ProjectBuildService(p,"/workspace/project").build(handle,"GRADLE"),/no JAR\/WAR output/);
});
test("Gradle explicit output supports subfolder and forbids traversal",async()=>{
 const p=new BuildProvider();
 const build=new ProjectBuildService(p,"/workspace/project");
 const r=await build.build(handle,"GRADLE",[{path:"web/build/libs/website.war"}]);
 assert.equal(r.outputs[0]?.kind,"war");
 assert.equal(r.outputs[0]?.filename,"website.war");
 await assert.rejects(()=>build.build(handle,"GRADLE",[{path:"../secrets"}]),/Invalid build output path/);
});
