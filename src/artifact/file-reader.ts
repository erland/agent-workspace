import { gunzipSync, inflateRawSync } from "node:zlib";
import { validateZipArchive } from "../archive/archive-validator.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_READ_CHARS = 65536;

export function readTextFile(bytes: Uint8Array, filename: string, path?: string, offset = 0, limit = 32768) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_READ_CHARS) {
    throw new Error("Invalid text read offset or limit");
  }
  const content = path ? extractArchiveFile(bytes, filename, path) : bytes;
  if (content.byteLength > MAX_FILE_BYTES) throw new Error("Text file exceeds 5 MiB limit");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  const segment = text.slice(offset, offset + limit);
  return { text: segment, offset, nextOffset: offset + segment.length < text.length ? offset + segment.length : null, totalChars: text.length, truncated: offset + segment.length < text.length };
}

function validPath(path: string) {
  if (!path || path.length > 1024 || path.startsWith("/") || path.includes("\\") ||
      path.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Invalid archive path");
}

function extractArchiveFile(data: Uint8Array, filename: string, path: string): Uint8Array {
  validPath(path);
  if (filename.endsWith(".zip")) return zipEntry(data, path);
  if (filename.endsWith(".tar.gz") || filename.endsWith(".tgz")) return tarEntry(data, path);
  throw new Error("Requested artifact is not ZIP or tar.gz");
}

function zipEntry(data: Uint8Array, path: string): Uint8Array {
  const manifest = validateZipArchive(data);
  const entry = manifest.entries.find(e => e.path === path && !e.directory);
  if (!entry) throw new Error("File not found in ZIP");
  if (entry.uncompressedBytes > MAX_FILE_BYTES) throw new Error("Text file exceeds 5 MiB limit");
  const b = Buffer.from(data);
  // Locate central directory and its local header offset for this validated entry.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Invalid ZIP");
  let pos = b.readUInt32LE(eocd + 16);
  const count = b.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(pos) !== 0x02014b50) throw new Error("Invalid ZIP directory");
    const nameLen = b.readUInt16LE(pos + 28);
    const extra = b.readUInt16LE(pos + 30);
    const comment = b.readUInt16LE(pos + 32);
    const name = b.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    if (name === path) {
      const method = b.readUInt16LE(pos + 10);
      const compressed = b.readUInt32LE(pos + 20);
      const local = b.readUInt32LE(pos + 42);
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      const encoded = b.subarray(start, start + compressed);
      const decoded = method === 0 ? encoded : method === 8 ? inflateRawSync(encoded, { maxOutputLength: MAX_FILE_BYTES + 1 }) : (() => { throw new Error("Unsupported ZIP compression"); })();
      if (decoded.byteLength !== entry.uncompressedBytes) throw new Error("ZIP size mismatch");
      return decoded;
    }
    pos += 46 + nameLen + extra + comment;
  }
  throw new Error("File not found in ZIP");
}

function tarEntry(data: Uint8Array, path: string): Uint8Array {
  const tar = gunzipSync(data, { maxOutputLength: 100 * 1024 * 1024 });
  let offset = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const str = (part: Uint8Array) => Buffer.from(part).toString("utf8").split("\0", 1)[0]!;
    const prefix = str(header.subarray(345, 500));
    const name = str(header.subarray(0, 100));
    const fullName = (prefix ? prefix + "/" : "") + name;
    const normalized = fullName.replace(/^\.\//, "");
    const sizeRaw = str(header.subarray(124, 136)).trim();
    const size = parseInt(sizeRaw, 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.byteLength) throw new Error("Invalid TAR");
    const type = header[156];
    if (normalized === path) {
      if (type !== 0 && type !== 48) throw new Error("Only regular TAR files may be read");
      if (size > MAX_FILE_BYTES) throw new Error("Text file exceeds 5 MiB limit");
      return tar.subarray(offset + 512, offset + 512 + size);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("File not found in TAR");
}
