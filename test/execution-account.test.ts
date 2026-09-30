import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InMemoryExecutionAccountCredentialStore,
  type ExecutionAccount
} from "../src/execution/execution-account.js";
import { modalClientParamsFromCredentials } from "../src/providers/modal/modal-credentials.js";
import { DefaultExecutionProviderFactory } from "../src/execution/execution-provider-factory.js";

describe("Modal execution account credentials", () => {
  it("maps OAuth credentials to ModalClient parameters without renaming secrets into domain fields", () => {
    const params = modalClientParamsFromCredentials({
      kind: "oauth",
      refreshToken: "refresh-user-1",
      clientId: "oc-client",
      clientSecret: "ov-secret"
    });

    assert.deepEqual(params, {
      oauthRefreshToken: "refresh-user-1",
      oauthClientId: "oc-client",
      oauthClientSecret: "ov-secret"
    });
  });

  it("keeps two users' credentials isolated by credentialRef", async () => {
    const store = new InMemoryExecutionAccountCredentialStore();
    store.put("cred-user-1", {
      kind: "oauth",
      refreshToken: "refresh-user-1",
      clientId: "oc-client",
      clientSecret: "ov-secret"
    });
    store.put("cred-user-2", {
      kind: "oauth",
      refreshToken: "refresh-user-2",
      clientId: "oc-client",
      clientSecret: "ov-secret"
    });

    const one = await store.getModalCredentials("cred-user-1");
    const two = await store.getModalCredentials("cred-user-2");

    assert.equal(one.kind, "oauth");
    assert.equal(two.kind, "oauth");
    if (one.kind === "oauth" && two.kind === "oauth") {
      assert.equal(one.refreshToken, "refresh-user-1");
      assert.equal(two.refreshToken, "refresh-user-2");
      assert.notEqual(one.refreshToken, two.refreshToken);
    }
  });

  it("rejects disconnected accounts before a provider is created", async () => {
    const store = new InMemoryExecutionAccountCredentialStore();
    store.put("cred-user-1", {
      kind: "oauth",
      refreshToken: "refresh-user-1",
      clientId: "oc-client",
      clientSecret: "ov-secret"
    });

    const account: ExecutionAccount = {
      id: "ea-1",
      userId: "user-1",
      provider: "modal",
      credentialRef: "cred-user-1",
      status: "REVOKED"
    };

    const factory = new DefaultExecutionProviderFactory(store, "agent-workspace-test");
    await assert.rejects(() => factory.createForAccount(account), /not connected/);
  });

  it("returns defensive copies from the credential store", async () => {
    const store = new InMemoryExecutionAccountCredentialStore();
    store.put("cred-user-1", {
      kind: "oauth",
      refreshToken: "refresh-user-1",
      clientId: "oc-client",
      clientSecret: "ov-secret"
    });

    const credentials = await store.getModalCredentials("cred-user-1");
    if (credentials.kind === "oauth") {
      credentials.refreshToken = "modified";
    }

    const again = await store.getModalCredentials("cred-user-1");
    assert.equal(again.kind, "oauth");
    if (again.kind === "oauth") {
      assert.equal(again.refreshToken, "refresh-user-1");
    }
  });
});
