import { loadModalConfig } from "../config/modal-config.js";
import type { WorkspaceHandle } from "../core/sandbox-provider.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";

const DEFAULT_IMAGE = "node:22-bookworm-slim";

async function main(): Promise<void> {
  const config = loadModalConfig();
  const provider = new ModalSandboxProvider(config);

  let handle: WorkspaceHandle | undefined;
  try {
    handle = await provider.createWorkspace({
      imageRef: DEFAULT_IMAGE,
      timeoutMs: 5 * 60 * 1000,
      cpu: 0.5,
      memoryMiB: 512
    });

    const result = await provider.exec(handle, {
      argv: ["node", "--version"],
      timeoutMs: 30_000
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `node --version failed with exit code ${result.exitCode}: ${result.stderr}`
      );
    }

    console.log(`Modal sandbox ${handle.providerWorkspaceId}`);
    console.log(`node --version => ${result.stdout.trim()}`);
  } finally {
    if (handle !== undefined) {
      await provider.terminate(handle);
      console.log("Sandbox terminated");
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
