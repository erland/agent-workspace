import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EncryptedExecutionAccountCredentialStore } from "../src/execution/encrypted-credential-store.js";
import { ModalCredentialManager, type ModalCredentialVerifier } from "../src/execution/modal-credential-manager.js";
import type { ModalExecutionCredentials } from "../src/execution/execution-account.js";
import type {
  EncryptedCredentialRecord,
  EncryptedCredentialRepository,
  ExecutionAccountRepository
} from "../src/persistence/repositories.js";
import type { PersistedExecutionAccount } from "../src/persistence/models.js";

class MemoryCredentialRepository implements EncryptedCredentialRepository {
  records = new Map<string, EncryptedCredentialRecord>();
  async upsert(record: EncryptedCredentialRecord) { this.records.set(record.ref, structuredClone(record)); }
  async findByRef(ref: string) { const record = this.records.get(ref); return record ? structuredClone(record) : undefined; }
  async deleteByRef(ref: string) { this.records.delete(ref); }
}

class MemoryAccountRepository implements ExecutionAccountRepository {
  accounts = new Map<string, PersistedExecutionAccount>();
  async upsert(account: PersistedExecutionAccount) { this.accounts.set(account.userId, structuredClone(account)); }
  async findByUserId(userId: string) { const account = this.accounts.get(userId); return account ? structuredClone(account) : undefined; }
}

class RecordingVerifier implements ModalCredentialVerifier {
  calls: ModalExecutionCredentials[] = [];
  fail = false;
  authFail = false;
  async verify(credentials: Extract<ModalExecutionCredentials, { kind: "token" }>) {
    this.calls.push(structuredClone(credentials));
    if (this.authFail) {
      const error = new Error("token has expired");
      error.name = "AuthError";
      throw error;
    }
    if (this.fail) throw new Error("temporary verification failure");
  }
}

describe("EncryptedExecutionAccountCredentialStore", () => {
  it("encrypts token material and decrypts it only with the configured key", async () => {
    const repository = new MemoryCredentialRepository();
    const key = Buffer.alloc(32, 7);
    const store = new EncryptedExecutionAccountCredentialStore(repository, key);
    const ref = await store.putModalToken("usr-1", "ak-test", "as-super-secret");
    const record = repository.records.get(ref);
    assert.ok(record);
    assert.equal(record.ciphertext.includes("ak-test"), false);
    assert.equal(record.ciphertext.includes("as-super-secret"), false);
    assert.deepEqual(await store.getModalCredentials(ref), {
      kind: "token",
      tokenId: "ak-test",
      tokenSecret: "as-super-secret"
    });
  });

  it("rejects tampered ciphertext", async () => {
    const repository = new MemoryCredentialRepository();
    const store = new EncryptedExecutionAccountCredentialStore(repository, Buffer.alloc(32, 9));
    const ref = await store.putModalToken("usr-1", "ak-test", "as-secret");
    const record = repository.records.get(ref)!;
    record.ciphertext = Buffer.from("tampered").toString("base64");
    repository.records.set(ref, record);
    await assert.rejects(() => store.getModalCredentials(ref), /could not be decrypted/);
  });

  it("rejects a different encryption key", async () => {
    const repository = new MemoryCredentialRepository();
    const store = new EncryptedExecutionAccountCredentialStore(repository, Buffer.alloc(32, 1));
    const ref = await store.putModalToken("usr-1", "ak-test", "as-secret");
    const wrong = new EncryptedExecutionAccountCredentialStore(repository, Buffer.alloc(32, 2));
    await assert.rejects(() => wrong.getModalCredentials(ref), /could not be decrypted/);
  });
});

describe("ModalCredentialManager", () => {
  it("verifies before persisting and connects the user account", async () => {
    const encrypted = new MemoryCredentialRepository();
    const store = new EncryptedExecutionAccountCredentialStore(encrypted, Buffer.alloc(32, 3), () => new Date("2026-09-30T18:00:00Z"));
    const accounts = new MemoryAccountRepository();
    const verifier = new RecordingVerifier();
    const manager = new ModalCredentialManager(accounts, store, verifier, () => new Date("2026-09-30T18:00:00Z"), () => "exa-1");

    await manager.saveAndTest("usr-1", "ak-1", "as-1");
    assert.equal(verifier.calls.length, 1);
    assert.equal((await accounts.findByUserId("usr-1"))?.status, "CONNECTED");
    assert.equal((await accounts.findByUserId("usr-1"))?.credentialRef, "secret:modal:usr-1");
  });

  it("does not persist invalid credentials as connected", async () => {
    const encrypted = new MemoryCredentialRepository();
    const store = new EncryptedExecutionAccountCredentialStore(encrypted, Buffer.alloc(32, 4));
    const accounts = new MemoryAccountRepository();
    const verifier = new RecordingVerifier();
    verifier.fail = true;
    const manager = new ModalCredentialManager(accounts, store, verifier);

    await assert.rejects(() => manager.saveAndTest("usr-1", "ak-bad", "as-bad"));
    assert.equal(await accounts.findByUserId("usr-1"), undefined);
    assert.equal(encrypted.records.size, 0);
  });

  it("marks an existing connection as needing renewal after a Modal auth failure", async () => {
    const encrypted = new MemoryCredentialRepository();
    const store = new EncryptedExecutionAccountCredentialStore(encrypted, Buffer.alloc(32, 6));
    const accounts = new MemoryAccountRepository();
    const verifier = new RecordingVerifier();
    const manager = new ModalCredentialManager(accounts, store, verifier);

    await manager.saveAndTest("usr-1", "ak-1", "as-1");
    verifier.authFail = true;
    await assert.rejects(() => manager.test("usr-1"), /expired/);

    assert.equal((await accounts.findByUserId("usr-1"))?.status, "REVOKED");
    assert.deepEqual(await manager.status("usr-1"), {
      connected: false,
      needsRenewal: true,
      updatedAt: (await accounts.findByUserId("usr-1"))!.updatedAt
    });
  });

  it("does not mark credentials revoked for a non-authentication failure", async () => {
    const encrypted = new MemoryCredentialRepository();
    const store = new EncryptedExecutionAccountCredentialStore(encrypted, Buffer.alloc(32, 8));
    const accounts = new MemoryAccountRepository();
    const verifier = new RecordingVerifier();
    const manager = new ModalCredentialManager(accounts, store, verifier);

    await manager.saveAndTest("usr-1", "ak-1", "as-1");
    verifier.fail = true;
    await assert.rejects(() => manager.test("usr-1"), /temporary/);
    assert.equal((await accounts.findByUserId("usr-1"))?.status, "CONNECTED");
  });

  it("replacing credentials clears the renewal status", async () => {
    const encrypted = new MemoryCredentialRepository();
    const store = new EncryptedExecutionAccountCredentialStore(encrypted, Buffer.alloc(32, 10));
    const accounts = new MemoryAccountRepository();
    const verifier = new RecordingVerifier();
    const manager = new ModalCredentialManager(accounts, store, verifier);

    await manager.saveAndTest("usr-1", "ak-old", "as-old");
    verifier.authFail = true;
    await assert.rejects(() => manager.test("usr-1"));
    verifier.authFail = false;
    await manager.saveAndTest("usr-1", "ak-new", "as-new");

    assert.equal((await accounts.findByUserId("usr-1"))?.status, "CONNECTED");
    assert.deepEqual(await store.getModalCredentials("secret:modal:usr-1"), {
      kind: "token", tokenId: "ak-new", tokenSecret: "as-new"
    });
  });

  it("keeps users isolated and deletes credential material on disconnect", async () => {
    const encrypted = new MemoryCredentialRepository();
    const store = new EncryptedExecutionAccountCredentialStore(encrypted, Buffer.alloc(32, 5));
    const accounts = new MemoryAccountRepository();
    const verifier = new RecordingVerifier();
    const manager = new ModalCredentialManager(accounts, store, verifier);

    await manager.saveAndTest("usr-1", "ak-1", "as-1");
    await manager.saveAndTest("usr-2", "ak-2", "as-2");
    assert.notEqual(
      (await accounts.findByUserId("usr-1"))?.credentialRef,
      (await accounts.findByUserId("usr-2"))?.credentialRef
    );

    await manager.disconnect("usr-1");
    assert.equal((await accounts.findByUserId("usr-1"))?.status, "DISCONNECTED");
    await assert.rejects(() => store.getModalCredentials("secret:modal:usr-1"), /not found/);
    assert.deepEqual(await store.getModalCredentials("secret:modal:usr-2"), {
      kind: "token", tokenId: "ak-2", tokenSecret: "as-2"
    });
  });
});
