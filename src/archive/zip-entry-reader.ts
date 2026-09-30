import { inflateRawSync } from "node:zlib";

import { validateZipArchive } from "./archive-validator.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 0xffff + 22;

export class ZipEntryReadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ZipEntryReadError";
  }
}

export interface ZipTextEntryOptions {
  maxEntryBytes?: number;
}

interface CentralEntry {
  path: string;
  compressionMethod: number;
  compressedBytes: number;
  uncompressedBytes: number;
  localHeaderOffset: number;
}

/**
 * Reads selected small text files from an already safety-validated ZIP.
 * Only STORED (0) and DEFLATE (8) entries are accepted in v1.
 */
export function readZipTextEntries(
  archive: Uint8Array,
  requestedPaths: readonly string[],
  options: ZipTextEntryOptions = {}
): ReadonlyMap<string, string> {
  validateZipArchive(archive);
  const maxEntryBytes = options.maxEntryBytes ?? 256 * 1024;
  if (!Number.isSafeInteger(maxEntryBytes) || maxEntryBytes <= 0) {
    throw new Error("maxEntryBytes must be a positive safe integer");
  }

  const requested = new Set(requestedPaths.map(normalizePath));
  const bytes = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  const entries = parseCentralDirectory(bytes);
  const result = new Map<string, string>();

  for (const entry of entries) {
    const normalized = normalizePath(entry.path);
    if (!requested.has(normalized)) continue;
    if (entry.uncompressedBytes > maxEntryBytes) {
      throw new ZipEntryReadError(
        `ZIP metadata entry ${normalized} exceeds ${maxEntryBytes} bytes`
      );
    }

    const content = readEntry(bytes, entry);
    if (content.byteLength > maxEntryBytes) {
      throw new ZipEntryReadError(
        `ZIP metadata entry ${normalized} exceeds ${maxEntryBytes} bytes after decompression`
      );
    }

    try {
      result.set(normalized, new TextDecoder("utf-8", { fatal: true }).decode(content));
    } catch {
      throw new ZipEntryReadError(`ZIP metadata entry ${normalized} is not valid UTF-8`);
    }
  }

  return result;
}

function parseCentralDirectory(bytes: Buffer): CentralEntry[] {
  const eocdOffset = findEocd(bytes);
  if (eocdOffset < 0) throw new ZipEntryReadError("ZIP end record not found");
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entries: CentralEntry[] = [];
  let cursor = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(bytes, cursor, 46);
    if (bytes.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipEntryReadError(`Invalid central directory entry at index ${index}`);
    }
    const compressionMethod = bytes.readUInt16LE(cursor + 10);
    const compressedBytes = bytes.readUInt32LE(cursor + 20);
    const uncompressedBytes = bytes.readUInt32LE(cursor + 24);
    const fileNameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    requireRange(bytes, cursor + 46, fileNameLength + extraLength + commentLength);
    const path = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(cursor + 46, cursor + 46 + fileNameLength)
    );
    entries.push({ path, compressionMethod, compressedBytes, uncompressedBytes, localHeaderOffset });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntry(bytes: Buffer, entry: CentralEntry): Uint8Array {
  const offset = entry.localHeaderOffset;
  requireRange(bytes, offset, 30);
  if (bytes.readUInt32LE(offset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new ZipEntryReadError(`Invalid local header for ${entry.path}`);
  }
  const fileNameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  requireRange(bytes, dataOffset, entry.compressedBytes);
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedBytes);

  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed, { maxOutputLength: entry.uncompressedBytes });
  }
  throw new ZipEntryReadError(
    `Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.path}`
  );
}

function findEocd(bytes: Buffer): number {
  const start = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (offset >= 0 && bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function requireRange(bytes: Buffer, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new ZipEntryReadError("ZIP entry points outside archive");
  }
}
