import { DefaultExecutionProviderFactory } from "../execution/execution-provider-factory.js";
import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import {
  InMemoryExecutionAccountCredentialStore,
  type ExecutionAccount
} from "../execution/execution-account.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const clientId = required("AGENT_WORKSPACE_MODAL_OAUTH_CLIENT_ID");
  const clientSecret = required("AGENT_WORKSPACE_MODAL_OAUTH_CLIENT_SECRET");
  const refresh1 = required("AGENT_WORKSPACE_TEST_USER1_MODAL_OAUTH_REFRESH_TOKEN");
  const refresh2 = required("AGENT_WORKSPACE_TEST_USER2_MODAL_OAUTH_REFRESH_TOKEN");
  const appName = process.env.MODAL_APP_NAME?.trim() || "agent-workspace-dev011";

  if (refresh1 === refresh2) {
    throw new Error("The two test users must use different Modal OAuth refresh tokens");
  }

  const store = new InMemoryExecutionAccountCredentialStore();
  store.put("cred-user-1", {
    kind: "oauth",
    refreshToken: refresh1,
    clientId,
    clientSecret
  });
  store.put("cred-user-2", {
    kind: "oauth",
    refreshToken: refresh2,
    clientId,
    clientSecret
  });

  const accounts: ExecutionAccount[] = [
    {
      id: "ea-user-1",
      userId: "test-user-1",
      provider: "modal",
      credentialRef: "cred-user-1",
      status: "CONNECTED"
    },
    {
      id: "ea-user-2",
      userId: "test-user-2",
      provider: "modal",
      credentialRef: "cred-user-2",
      status: "CONNECTED"
    }
  ];

  const factory = new DefaultExecutionProviderFactory(store, appName);
  const handles: Array<{ accountId: string; provider: SandboxProvider; handle: WorkspaceHandle }> = [];

  try {
    for (const account of accounts) {
      const provider = await factory.createForAccount(account);
      const handle = await provider.createWorkspace({
        imageRef: "node:22-bookworm",
        timeoutMs: 5 * 60 * 1000,
        cpu: 1,
        memoryMiB: 1024
      });
      handles.push({ accountId: account.id, provider, handle });

      const result = await provider.exec(handle, {
        argv: ["node", "--version"],
        timeoutMs: 30_000
      });
      if (result.exitCode !== 0 || !result.stdout.trim().startsWith("v22.")) {
        throw new Error(`${account.id} smoke failed: ${result.stderr || result.stdout}`);
      }
      console.log(`${account.id}: ${handle.providerWorkspaceId} => ${result.stdout.trim()}`);
    }

    if (handles[0]?.handle.providerWorkspaceId === handles[1]?.handle.providerWorkspaceId) {
      throw new Error("Modal returned the same sandbox id for both test accounts");
    }

    console.log("Two user-specific Modal OAuth clients executed separate sandboxes successfully.");
  } finally {
    for (const item of handles.reverse()) {
      try {
        await item.provider.terminate(item.handle);
        console.log(`${item.accountId}: sandbox terminated`);
      } catch (error) {
        console.error(`${item.accountId}: cleanup failed`, error);
      }
    }
  }
}

await main();
