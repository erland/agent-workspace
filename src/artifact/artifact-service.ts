import { createHash, randomUUID } from "node:crypto";
import type { ArtifactRecord } from "../persistence/models.js";
import type { ArtifactRepository } from "../persistence/repositories.js";
import type { ObjectStore } from "../storage/object-store.js";

export interface PublishArtifactInput {
  workspaceId: string;
  name: string;
  kind: string;
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface ArtifactServiceOptions {
  ttlMinutes?: number;
  now?: () => Date;
  idFactory?: () => string;
  maxArtifactBytes?: number;
}

export class ArtifactService {
  private readonly ttlMinutes: number;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly maxArtifactBytes: number;

  constructor(
    private readonly userId: string,
    private readonly repository: ArtifactRepository,
    private readonly store: ObjectStore,
    options: ArtifactServiceOptions = {}
  ) {
    this.ttlMinutes = options.ttlMinutes ?? 60;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `art_${randomUUID()}`);
    this.maxArtifactBytes = options.maxArtifactBytes ?? 100 * 1024 * 1024;
  }

  async publish(input: PublishArtifactInput): Promise<ArtifactRecord> {
    if (input.bytes.byteLength === 0) throw new Error("Artifact is empty");
    if (input.bytes.byteLength > this.maxArtifactBytes) {
      throw new Error(`Artifact exceeds maximum size of ${this.maxArtifactBytes} bytes`);
    }
    const id = this.idFactory();
    const createdAt = this.now();
    const storageKey = `artifacts/${this.userId}/${id}/${safeFilename(input.filename)}`;
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    await this.store.put(storageKey, input.bytes);
    const record: ArtifactRecord = {
      id,
      userId: this.userId,
      workspaceId: input.workspaceId,
      name: input.name,
      kind: input.kind,
      filename: safeFilename(input.filename),
      mediaType: input.mediaType,
      sizeBytes: input.bytes.byteLength,
      sha256,
      storageKey,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMinutes * 60_000).toISOString()
    };
    try {
      await this.repository.upsert(record);
      return record;
    } catch (error) {
      await this.store.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async get(artifactId: string): Promise<ArtifactRecord> {
    const artifact = await this.repository.findByIdForUser(artifactId, this.userId);
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    if (Date.parse(artifact.expiresAt) <= this.now().getTime()) {
      await this.delete(artifact);
      throw new Error(`Artifact expired: ${artifactId}`);
    }
    return artifact;
  }

  async read(artifactId: string): Promise<{ artifact: ArtifactRecord; bytes: Uint8Array }> {
    const artifact = await this.get(artifactId);
    return { artifact, bytes: await this.store.get(artifact.storageKey) };
  }

  async list(workspaceId: string): Promise<ArtifactRecord[]> {
    const artifacts = await this.repository.listByWorkspaceForUser(workspaceId, this.userId);
    return artifacts.filter((artifact) => Date.parse(artifact.expiresAt) > this.now().getTime());
  }

  async cleanupExpired(limit = 100): Promise<number> {
    const expired = await this.repository.listExpired(this.now().toISOString(), limit);
    let count = 0;
    for (const artifact of expired) {
      await this.delete(artifact);
      count += 1;
    }
    return count;
  }

  private async delete(artifact: ArtifactRecord): Promise<void> {
    await this.store.delete(artifact.storageKey).catch(() => undefined);
    await this.repository.deleteById(artifact.id);
  }
}

function safeFilename(value: string): string {
  const name = value.replaceAll("\\", "/").split("/").at(-1)?.trim() ?? "";
  if (!name || name === "." || name === ".." || name.includes("\0")) throw new Error("Invalid artifact filename");
  return name;
}
