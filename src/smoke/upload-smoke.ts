import { loadModalConfig } from "../config/modal-config.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { makeStoredZip } from "./zip-fixture.js";

async function main(): Promise<void> {
  const provider = new ModalSandboxProvider(loadModalConfig());
  const service = new WorkspaceService(provider);
  const workspace = await service.create({ lifetimeMinutes: 5 });

  console.log(`Workspace ${workspace.id}`);
  console.log(`runtime => ${workspace.runtimeProfile}`);
  console.log(`provider sandbox => ${workspace.providerWorkspaceId}`);

  const handle = {
    providerId: workspace.providerId,
    providerWorkspaceId: workspace.providerWorkspaceId
  };

  try {
    const java = await provider.exec(handle, {
      argv: ["bash", "-lc", "java -version 2>&1 | head -n 1"],
      timeoutMs: 30_000
    });
    const node = await provider.exec(handle, {
      argv: ["node", "--version"],
      timeoutMs: 30_000
    });

    if (java.exitCode !== 0 || !java.stdout.includes("21")) {
      throw new Error(`Expected Java 21, got: ${java.stdout || java.stderr}`);
    }
    if (node.exitCode !== 0 || !/^v22\./.test(node.stdout.trim())) {
      throw new Error(`Expected Node 22, got: ${node.stdout || node.stderr}`);
    }

    const upload = await service.uploadZip(
      workspace.id,
      makeStoredZip([
        {
          path: "package.json",
          content: JSON.stringify({ engines: { node: "20.x" } })
        }
      ])
    );
    if (upload.validation.entryCount !== 1) {
      throw new Error(`Expected one ZIP entry, got ${upload.validation.entryCount}`);
    }
    if (upload.workspace.project?.analysis.projectType !== "NPM") {
      throw new Error(`Expected NPM project, got ${upload.workspace.project?.analysis.projectType}`);
    }
    if (upload.workspace.project.analysis.node?.version !== "20") {
      throw new Error(`Expected Node 20 detection, got ${upload.workspace.project.analysis.node?.version}`);
    }
    if (!upload.workspace.project.analysis.warnings.some((warning) => warning.code === "NODE_RUNTIME_MISMATCH")) {
      throw new Error("Expected Node runtime mismatch warning for locked Node 22 workspace");
    }

    const extracted = await provider.exec(handle, {
      argv: ["bash", "-lc", "test -f /workspace/project/package.json"],
      timeoutMs: 30_000
    });
    if (extracted.exitCode !== 0) {
      throw new Error(`Uploaded ZIP was not extracted: ${extracted.stderr}`);
    }

    console.log(`java => ${java.stdout.trim()}`);
    console.log(`node => ${node.stdout.trim()}`);
    console.log("ZIP validation => PASSED");
    console.log("ZIP extraction => PASSED");
    console.log("project detection => NPM");
    console.log("node detection => 20 with mismatch warning");
  } finally {
    const destroyed = await service.destroy(workspace.id);
    console.log(`workspace status => ${destroyed.status}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
