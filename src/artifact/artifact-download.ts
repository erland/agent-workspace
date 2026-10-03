import { createHmac, timingSafeEqual } from "node:crypto";
import type { ArtifactRecord } from "../persistence/models.js";

interface DownloadPayload {
  artifactId: string;
  userId: string;
  expiresAtEpochSeconds: number;
}

export class ArtifactDownloadSigner {
  constructor(
    private readonly secret: string,
    private readonly publicBaseUrl: string,
    private readonly nowMs: () => number = () => Date.now()
  ) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("AGENT_WORKSPACE_ARTIFACT_SIGNING_KEY must be at least 32 bytes");
    }
  }

  create(artifact: ArtifactRecord, ttlSeconds = 600): { url: string; expiresAt: string } {
    const artifactExpiry = Math.floor(Date.parse(artifact.expiresAt) / 1000);
    const requestedExpiry = Math.floor(this.nowMs() / 1000) + ttlSeconds;
    const expiresAtEpochSeconds = Math.min(artifactExpiry, requestedExpiry);
    const payload: DownloadPayload = {
      artifactId: artifact.id,
      userId: artifact.userId,
      expiresAtEpochSeconds
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.sign(encoded);
    const url = new URL(`/artifacts/download/${encoded}.${signature}`, this.publicBaseUrl).toString();
    return { url, expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString() };
  }

  verify(token: string): DownloadPayload {
    const separator = token.lastIndexOf(".");
    if (separator <= 0) throw new Error("Invalid artifact download token");
    const encoded = token.slice(0, separator);
    const supplied = token.slice(separator + 1);
    const expected = this.sign(encoded);
    const suppliedBytes = Buffer.from(supplied, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (
      suppliedBytes.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    ) {
      throw new Error("Invalid artifact download token");
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<DownloadPayload>;
    const expiresAtEpochSeconds = payload.expiresAtEpochSeconds;
    if (
      typeof payload.artifactId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof expiresAtEpochSeconds !== "number" ||
      !Number.isSafeInteger(expiresAtEpochSeconds)
    ) {
      throw new Error("Invalid artifact download token");
    }
    if (expiresAtEpochSeconds * 1000 <= this.nowMs()) {
      throw new Error("Artifact download link has expired");
    }
    return {
      artifactId: payload.artifactId,
      userId: payload.userId,
      expiresAtEpochSeconds
    };
  }

  private sign(encoded: string): string {
    return createHmac("sha256", this.secret).update(encoded).digest("base64url");
  }
}
