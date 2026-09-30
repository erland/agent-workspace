import type { ModalCredentialVerifier } from "../../execution/modal-credential-manager.js";
import type { ModalExecutionCredentials } from "../../execution/execution-account.js";
import { ModalSandboxProvider } from "./modal-sandbox-provider.js";

export class SandboxModalCredentialVerifier implements ModalCredentialVerifier {
  constructor(private readonly appName: string) {}

  async verify(credentials: Extract<ModalExecutionCredentials, { kind: "token" }>): Promise<void> {
    const provider = new ModalSandboxProvider({ appName: this.appName, credentials });
    let handle;
    try {
      handle = await provider.createWorkspace({
        imageRef: "alpine:3.20",
        timeoutMs: 60_000,
        cpu: 0.125,
        memoryMiB: 128,
        networkPolicy: { blockNetwork: true }
      });
      const result = await provider.exec(handle, {
        argv: ["sh", "-lc", "printf modal-ok"],
        timeoutMs: 15_000
      });
      if (result.exitCode !== 0 || result.stdout !== "modal-ok") {
        throw new Error("Modal credential verification failed");
      }
    } finally {
      if (handle) await provider.terminate(handle).catch(() => undefined);
    }
  }
}
