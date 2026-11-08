import assert from "node:assert/strict";
import test from "node:test";
import type { Command, CreateWorkspaceOptions, ExecutionResult, SandboxProvider, WorkspaceHandle } from "../src/core/sandbox-provider.js";
import { ProjectBuildService } from "../src/artifact/project-build-service.js";

const handle: WorkspaceHandle = { providerId: "fake", providerWorkspaceId: "fake" };
const ok = (stdout = ""): ExecutionResult => ({ exitCode: 0, stdout, stderr: "" });
class PythonBuildProvider implements SandboxProvider {
  commands: Command[] = [];
  reads: string[] = [];
  manifest = true;
  buildOk = true;
  discovered = ".agent-workspace-dist/demo-1.0.0-py3-none-any.whl\n.agent-workspace-dist/demo-1.0.0.tar.gz\n";
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> { return handle; }
  async uploadArchive(): Promise<void> {}
  async terminate(): Promise<void> {}
  async readFile(_handle: WorkspaceHandle, path: string): Promise<Uint8Array> {
    this.reads.push(path); return new Uint8Array([80,75,3,4]);
  }
  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    this.commands.push(command);
    const argv = command.argv;
    const joined = argv.join(" ");
    if (joined.includes("test -f pyproject.toml")) return this.manifest ? ok() : {exitCode:1,stdout:"",stderr:""};
    if (joined.includes(" -m build --outdir ")) return this.buildOk ? ok() : {exitCode:3,stdout:"",stderr:"backend failed"};
    if (joined.includes("find .agent-workspace-dist")) return ok(this.discovered);
    if (joined.includes("if [ -f") && joined.includes("elif [ -d")) {
      if (joined.includes("missing-output")) return {exitCode:2,stdout:"",stderr:""};
      return ok("file");
    }
    if (argv[0] === "stat") return ok("4");
    return ok();
  }
}
test("PEP 517 build produces wheel and sdist with accurate metadata", async () => {
  const p = new PythonBuildProvider();
  const r = await new ProjectBuildService(p, "/workspace/project/backend").build(handle, "PYTHON");
  assert.equal(r.status, "PASSED");
  assert.equal(r.projectType, "PYTHON");
  assert.deepEqual(r.outputs.map(o => [o.kind,o.mediaType,o.filename]), [
    ["wheel","application/zip","demo-1.0.0-py3-none-any.whl"],
    ["sdist","application/gzip","demo-1.0.0.tar.gz"]
  ]);
  assert.deepEqual(p.reads, [
    "/workspace/project/backend/.agent-workspace-dist/demo-1.0.0-py3-none-any.whl",
    "/workspace/project/backend/.agent-workspace-dist/demo-1.0.0.tar.gz"
  ]);
  assert.ok(p.commands.some(c => c.argv.join(" ") === "python3 -m venv .agent-workspace-build-venv"));
  assert.ok(p.commands.some(c => c.argv.join(" ").includes("build==1.3.0")));
  assert.ok(p.commands.some(c => c.argv.join(" ").includes("-m build --outdir")));
  assert.ok(p.commands.every(c => c.workdir === "/workspace/project/backend"));
});
test("requirements-only Python source cannot claim a distributable build", async () => {
  const p = new PythonBuildProvider(); p.manifest = false;
  await assert.rejects(() => new ProjectBuildService(p,"/workspace/project").build(handle,"PYTHON"), /requires pyproject.toml/);
  assert.equal(p.commands.length,1);
});
test("Python build backend errors stop publication", async () => {
  const p = new PythonBuildProvider(); p.buildOk=false;
  await assert.rejects(() => new ProjectBuildService(p,"/workspace/project").build(handle,"PYTHON"), /backend failed/);
  assert.deepEqual(p.reads,[]);
});
test("Python builds do not pass when no wheel or sdist was generated", async () => {
  const p = new PythonBuildProvider(); p.discovered="";
  await assert.rejects(() => new ProjectBuildService(p,"/workspace/project").build(handle,"PYTHON"), /no wheel\/sdist/);
});
test("explicit Python artifact requests are validated and safely bounded", async () => {
  const p = new PythonBuildProvider();
  const build = new ProjectBuildService(p,"/workspace/project");
  const r=await build.build(handle,"PYTHON",[{path:".agent-workspace-dist/demo-1.0.0-py3-none-any.whl"}]);
  assert.equal(r.outputs.length,1);
  assert.equal(r.outputs[0]?.kind,"wheel");
  await assert.rejects(() => build.build(handle,"PYTHON",[{path:"../secret"}]),/Invalid build output path/);
});
