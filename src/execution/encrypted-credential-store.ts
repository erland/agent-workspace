import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type {
  ModalExecutionCredentials,
  MutableExecutionAccountCredentialStore
} from "./execution-account.js";
import type {
  EncryptedCredentialRecord,
  EncryptedCredentialRepository
} from "../persistence/repositories.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export class EncryptedExecutionAccountCredentialStore
  implements MutableExecutionAccountCredentialStore {
  constructor(
    private readonly repository: EncryptedCredentialRepository,
    private readonly key: Buffer,
    private readonly now: () => Date = () => new Date()
  ) {
    if (key.length !== 32) {
      throw new Error("Credential encryption key must decode to exactly 32 bytes");
    }
  }

  static fromEnvironment(
    repository: EncryptedCredentialRepository,
    env: NodeJS.ProcessEnv = process.env
  ): EncryptedExecutionAccountCredentialStore {
    const encoded = env.AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY?.trim();
    if (!encoded) throw new Error("AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY is required");
    const key = Buffer.from(encoded, "base64");
    return new EncryptedExecutionAccountCredentialStore(repository, key);
  }

  async putModalToken(userId: string, tokenId: string, tokenSecret: string): Promise<string> {
    const normalizedId = requiredSecret(tokenId, "tokenId");
    const normalizedSecret = requiredSecret(tokenSecret, "tokenSecret");
    const ref = `secret:modal:${userId}`;
    const payload = Buffer.from(JSON.stringify({
      kind: "token",
      tokenId: normalizedId,
      tokenSecret: normalizedSecret
    } satisfies ModalExecutionCredentials), "utf8");
    const encrypted = encrypt(payload, this.key, ref);
    const existing = await this.repository.findByRef(ref);
    const now = this.now().toISOString();
    await this.repository.upsert({
      ref,
      userId,
      provider: "modal",
      ...encrypted,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    return ref;
  }

  async getModalCredentials(credentialRef: string): Promise<ModalExecutionCredentials> {
    const record = await this.repository.findByRef(credentialRef);
    if (!record) throw new Error(`Credentials not found for execution account ref: ${credentialRef}`);
    try {
      const plaintext = decrypt(record, this.key);
      const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
      if (!isModalTokenCredentials(parsed)) throw new Error("Unsupported credential payload");
      return parsed;
    } catch (error) {
      const wrapped = new Error("Stored credentials could not be decrypted");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async deleteCredentials(credentialRef: string): Promise<void> {
    await this.repository.deleteByRef(credentialRef);
  }
}

function requiredSecret(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} must not be blank`);
  return trimmed;
}

function encrypt(plaintext: Buffer, key: Buffer, aad: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

function decrypt(record: EncryptedCredentialRecord, key: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, "base64"));
  decipher.setAAD(Buffer.from(record.ref, "utf8"));
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final()
  ]);
}

function isModalTokenCredentials(value: unknown): value is Extract<ModalExecutionCredentials, { kind: "token" }> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "token"
    && typeof candidate.tokenId === "string"
    && candidate.tokenId.length > 0
    && typeof candidate.tokenSecret === "string"
    && candidate.tokenSecret.length > 0;
}
