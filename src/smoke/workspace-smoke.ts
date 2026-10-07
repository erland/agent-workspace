import { loadModalConfig } from "../config/modal-config.js";
import { RUNTIME_PROFILES } from "../core/runtime-profile.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { WorkspaceService } from "../workspace/workspace-service.js";

async function main(): Promise<void> {
  const provider = new ModalSandboxProvider(loadModalConfig());
  const service = new WorkspaceService(provider);

  const workspace = await service.create({ lifetimeMinutes: 5 });
  console.log(`Workspace ${workspace.id}`);
  console.log(`runtime => ${workspace.runtimeProfile}`);
  console.log(`status => ${workspace.status}`);
  const profile = RUNTIME_PROFILES[workspace.runtimeProfile];
  const handle = await provider.createWorkspace({
    imageRef: profile.imageRef,
    timeoutMs: 5 * 60_000
  });

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

    console.log(`java => ${java.stdout.trim()}`);
    console.log(`node => ${node.stdout.trim()}`);
  } finally {
    await provider.terminate(handle);
    const destroyed = await service.destroy(workspace.id);
    console.log(`workspace status => ${destroyed.status}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
