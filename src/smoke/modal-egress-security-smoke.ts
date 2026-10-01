import { loadModalConfig } from "../config/modal-config.js";
import type { WorkspaceHandle } from "../core/sandbox-provider.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { DEFAULT_SECURITY_POLICY } from "../security/security-policy.js";
import { resolveRuntimeProfile } from "../core/runtime-profile.js";

async function main(): Promise<void> {
  const provider = new ModalSandboxProvider(loadModalConfig());
  const profile = resolveRuntimeProfile();
  let handle: WorkspaceHandle | undefined;

  try {
    handle = await provider.createWorkspace({
      imageRef: profile.imageRef,
      timeoutMs: 5 * 60 * 1000,
      cpu: 0.5,
      memoryMiB: 512,
      networkPolicy: DEFAULT_SECURITY_POLICY.networkPolicy
    });

    await expectAllowed(provider, handle, "allowlisted TLS domain", [
      "curl", "-fsSIL", "--max-time", "15", "https://registry.npmjs.org/"
    ]);

    await expectBlocked(provider, handle, "non-allowlisted TLS domain", [
      "curl", "-fsSIL", "--max-time", "10", "https://example.com/"
    ]);

    await expectBlocked(provider, handle, "direct public IP", [
      "curl", "-fsSIL", "--max-time", "10", "http://1.1.1.1/"
    ]);

    await expectBlocked(provider, handle, "private RFC1918 IP", [
      "curl", "-fsSIL", "--max-time", "5", "http://10.0.0.1/"
    ]);

    await expectBlocked(provider, handle, "link-local metadata IP", [
      "curl", "-fsSIL", "--max-time", "5", "http://169.254.169.254/"
    ]);

    console.log("Modal egress security smoke: PASS");
  } finally {
    if (handle) await provider.terminate(handle);
  }
}

async function expectAllowed(
  provider: ModalSandboxProvider,
  handle: WorkspaceHandle,
  label: string,
  argv: string[]
): Promise<void> {
  const result = await provider.exec(handle, { argv, timeoutMs: 20_000 });
  if (result.exitCode !== 0) {
    throw new Error(`${label} unexpectedly blocked: ${result.stderr || result.stdout}`);
  }
  console.log(`${label} => ALLOWED as expected`);
}

async function expectBlocked(
  provider: ModalSandboxProvider,
  handle: WorkspaceHandle,
  label: string,
  argv: string[]
): Promise<void> {
  const result = await provider.exec(handle, { argv, timeoutMs: 20_000 });
  if (result.exitCode === 0) {
    throw new Error(`${label} unexpectedly allowed`);
  }
  console.log(`${label} => BLOCKED as expected`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
