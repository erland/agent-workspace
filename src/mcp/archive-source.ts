import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { DEFAULT_ARCHIVE_LIMITS } from "../archive/archive-validator.js";

export interface OpenAIFileParameter {
  download_url: string;
  file_id: string;
  mime_type?: string | undefined;
  file_name?: string | undefined;
}

export interface RemoteArchiveDownloaderOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  lookup?: typeof dnsLookup;
}

export class RemoteArchiveDownloader {
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly fetchImpl: typeof fetch;
  private readonly lookup: typeof dnsLookup;

  public constructor(options: RemoteArchiveDownloaderOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_ARCHIVE_LIMITS.maxCompressedBytes;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.lookup = options.lookup ?? dnsLookup;
  }

  public async download(url: string): Promise<Uint8Array> {
    let current = new URL(url);

    for (let redirect = 0; redirect <= this.maxRedirects; redirect += 1) {
      await this.validateUrl(current);

      const response = await this.fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (isRedirect(response.status)) {
        if (redirect === this.maxRedirects) {
          throw new Error(`Archive download exceeded ${this.maxRedirects} redirects`);
        }
        const location = response.headers.get("location");
        if (!location) throw new Error("Archive download redirect is missing Location");
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Archive download failed with HTTP ${response.status}`);
      }

      const declaredLength = parseContentLength(response.headers.get("content-length"));
      if (declaredLength !== undefined && declaredLength > this.maxBytes) {
        throw new Error(`Archive download size ${declaredLength} exceeds limit ${this.maxBytes}`);
      }

      return this.readBounded(response);
    }

    throw new Error("Archive download failed");
  }

  private async validateUrl(url: URL): Promise<void> {
    if (url.protocol !== "https:") throw new Error("Archive URL must use HTTPS");
    if (url.username || url.password) throw new Error("Archive URL must not contain credentials");

    const host = stripIpv6Brackets(url.hostname);
    if (host.toLowerCase() === "localhost") throw new Error("Archive URL must not target a private address");

    const literalFamily = isIP(host);
    if (literalFamily !== 0) {
      if (isPrivateAddress(host)) throw new Error("Archive URL must not target a private address");
      return;
    }

    const addresses = await this.lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error("Archive URL must resolve only to public addresses");
    }
  }

  private async readBounded(response: Response): Promise<Uint8Array> {
    if (!response.body) throw new Error("Archive download returned an empty response body");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Archive download exceeds limit ${this.maxBytes}`);
      }
      chunks.push(value);
    }

    if (total === 0) throw new Error("Archive download returned an empty archive");

    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
}

export function decodeBase64Archive(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("archiveBase64 must be valid base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) throw new Error("archiveBase64 decoded to an empty archive");
  return bytes;
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("Archive download returned an invalid Content-Length");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Archive download Content-Length is too large");
  return parsed;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  if (a === undefined || b === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]!) : false;
}
