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
  try {
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

    const verified = await service.verifyProject(workspace.id);
    if (verified.status !== "PASSED" || verified.projectType !== "NPM") {
      throw new Error("Expected stored ZIP to verify in an ephemeral execution sandbox");
    }

    console.log("ZIP validation => PASSED");
    console.log("project detection => NPM");
    console.log("node detection => 20 with mismatch warning");
    console.log("ephemeral extraction/verification => PASSED");
  } finally {
    const destroyed = await service.destroy(workspace.id);
    console.log(`workspace status => ${destroyed.status}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
