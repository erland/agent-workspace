import { loadModalConfig } from "../config/modal-config.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { makeStoredZip } from "./zip-fixture.js";

const lockfile = JSON.stringify({
  name: "agent-workspace-npm-smoke",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "agent-workspace-npm-smoke", version: "1.0.0" }
  }
});

function packageJson(failing: boolean): string {
  return JSON.stringify({
    name: "agent-workspace-npm-smoke",
    version: "1.0.0",
    private: true,
    scripts: {
      test: "node test.js",
      build: "node build.js"
    },
    engines: { node: "22" },
    agentWorkspaceSmokeFail: failing
  });
}

function archive(failing: boolean): Uint8Array {
  return makeStoredZip([
    { path: "package.json", content: packageJson(failing) },
    { path: "package-lock.json", content: lockfile },
    {
      path: "test.js",
      content: failing
        ? "console.error('intentional npm smoke failure'); process.exit(7);\n"
        : "console.log('npm smoke tests passed');\n"
    },
    {
      path: "build.js",
      content: "require('fs').mkdirSync('dist',{recursive:true}); require('fs').writeFileSync('dist/result.txt','built'); console.log('build passed');\n"
    }
  ]);
}

async function verifyCase(service: WorkspaceService, failing: boolean): Promise<void> {
  const workspace = await service.create({ lifetimeMinutes: 5 });
  try {
    await service.uploadZip(workspace.id, archive(failing));
    const result = await service.verifyNpm(workspace.id);
    if (!failing) {
      if (result.status !== "PASSED") throw new Error(`Expected PASS, got ${JSON.stringify(result)}`);
      if (result.steps.map((step) => step.name).join(",") !== "install,test,build") {
        throw new Error(`Unexpected PASS steps: ${JSON.stringify(result.steps)}`);
      }
      console.log(`npm PASS => ${result.steps.length} steps, ${result.durationMs} ms`);
    } else {
      if (result.status !== "FAILED" || result.failedStep !== "test" || result.exitCode !== 7) {
        throw new Error(`Expected normalized test failure, got ${JSON.stringify(result)}`);
      }
      if (!result.logExcerpt?.includes("intentional npm smoke failure")) {
        throw new Error(`Expected failure log excerpt, got ${result.logExcerpt}`);
      }
      console.log(`npm FAIL => ${result.failedStep}, exit ${result.exitCode}`);
      console.log(`failure excerpt => ${result.logExcerpt}`);
    }
  } finally {
    const destroyed = await service.destroy(workspace.id);
    console.log(`workspace status => ${destroyed.status}`);
  }
}

async function main(): Promise<void> {
  const provider = new ModalSandboxProvider(loadModalConfig());
  const service = new WorkspaceService(provider);
  await verifyCase(service, false);
  await verifyCase(service, true);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
