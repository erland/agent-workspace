const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 0xffff + 22;

export const DEFAULT_ARCHIVE_LIMITS = {
  maxCompressedBytes: 100 * 1024 * 1024,
  maxUncompressedBytes: 500 * 1024 * 1024,
  maxEntries: 20_000,
  maxPathLength: 1024
} as const;

export interface ArchiveValidationLimits {
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
  maxEntries: number;
  maxPathLength: number;
}

export type ArchiveValidationErrorCode =
  | "ARCHIVE_TOO_LARGE"
  | "UNCOMPRESSED_TOO_LARGE"
  | "TOO_MANY_ENTRIES"
  | "PATH_TOO_LONG"
  | "ILLEGAL_PATH"
  | "MALFORMED_ARCHIVE"
  | "ENCRYPTED_ENTRY"
  | "SYMLINK_ENTRY"
  | "UNSUPPORTED_ZIP64";

export class ArchiveValidationError extends Error {
  public constructor(
    public readonly code: ArchiveValidationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ArchiveValidationError";
  }
}

export interface ArchiveEntryInfo {
  path: string;
  compressedBytes: number;
  uncompressedBytes: number;
  directory: boolean;
}

export interface ArchiveValidationResult {
  entryCount: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  entries: readonly ArchiveEntryInfo[];
}

export function validateZipArchive(
  archive: Uint8Array,
  overrides: Partial<ArchiveValidationLimits> = {}
): ArchiveValidationResult {
  const limits: ArchiveValidationLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
  validateLimits(limits);

  if (archive.byteLength > limits.maxCompressedBytes) {
    throw new ArchiveValidationError(
      "ARCHIVE_TOO_LARGE",
      `ZIP size ${archive.byteLength} exceeds limit ${limits.maxCompressedBytes}`
    );
  }

  const bytes = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocdOffset = findEocd(bytes);
  if (eocdOffset < 0) {
    malformed("End of central directory not found");
  }

  const diskNumber = readUInt16(bytes, eocdOffset + 4);
  const centralDisk = readUInt16(bytes, eocdOffset + 6);
  const entriesOnDisk = readUInt16(bytes, eocdOffset + 8);
  const totalEntries = readUInt16(bytes, eocdOffset + 10);
  const centralSize = readUInt32(bytes, eocdOffset + 12);
  const centralOffset = readUInt32(bytes, eocdOffset + 16);
  const commentLength = readUInt16(bytes, eocdOffset + 20);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    malformed("Multi-disk ZIP archives are not supported");
  }
  if (
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ArchiveValidationError("UNSUPPORTED_ZIP64", "ZIP64 archives are not supported in v1");
  }
  if (eocdOffset + 22 + commentLength !== bytes.length) {
    malformed("ZIP end record or comment length is inconsistent");
  }
  if (totalEntries > limits.maxEntries) {
    throw new ArchiveValidationError(
      "TOO_MANY_ENTRIES",
      `ZIP contains ${totalEntries} entries; limit is ${limits.maxEntries}`
    );
  }
  if (centralOffset + centralSize > eocdOffset || centralOffset > bytes.length) {
    malformed("Central directory points outside the ZIP archive");
  }

  const entries: ArchiveEntryInfo[] = [];
  const seenPaths = new Set<string>();
  let cursor = centralOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(bytes, cursor, 46);
    if (readUInt32(bytes, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      malformed(`Invalid central directory entry at index ${index}`);
    }

    const versionMadeBy = readUInt16(bytes, cursor + 4);
    const flags = readUInt16(bytes, cursor + 8);
    const compressedBytes = readUInt32(bytes, cursor + 20);
    const uncompressedBytes = readUInt32(bytes, cursor + 24);
    const fileNameLength = readUInt16(bytes, cursor + 28);
    const extraLength = readUInt16(bytes, cursor + 30);
    const fileCommentLength = readUInt16(bytes, cursor + 32);
    const diskStart = readUInt16(bytes, cursor + 34);
    const externalAttributes = readUInt32(bytes, cursor + 38);
    const localHeaderOffset = readUInt32(bytes, cursor + 42);

    if (
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      throw new ArchiveValidationError("UNSUPPORTED_ZIP64", "ZIP64 entries are not supported in v1");
    }
    if ((flags & 0x0001) !== 0) {
      throw new ArchiveValidationError("ENCRYPTED_ENTRY", "Encrypted ZIP entries are not supported");
    }
    if (diskStart !== 0) {
      malformed("Multi-disk ZIP entry is not supported");
    }

    const entryLength = 46 + fileNameLength + extraLength + fileCommentLength;
    requireRange(bytes, cursor, entryLength);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + fileNameLength);
    const path = decodePath(nameBytes);
    const normalizedPath = validateArchivePath(path, limits.maxPathLength);
    if (seenPaths.has(normalizedPath)) {
      malformed(`Duplicate ZIP entry path: ${normalizedPath}`);
    }
    seenPaths.add(normalizedPath);

    const madeByOs = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (madeByOs === 3 && (unixMode & 0o170000) === 0o120000) {
      throw new ArchiveValidationError(
        "SYMLINK_ENTRY",
        `Symbolic links are not allowed in ZIP archives: ${normalizedPath}`
      );
    }

    validateLocalHeader(
      bytes,
      localHeaderOffset,
      nameBytes,
      compressedBytes,
      centralOffset
    );

    totalCompressedBytes = safeAdd(totalCompressedBytes, compressedBytes);
    totalUncompressedBytes = safeAdd(totalUncompressedBytes, uncompressedBytes);
    if (totalUncompressedBytes > limits.maxUncompressedBytes) {
      throw new ArchiveValidationError(
        "UNCOMPRESSED_TOO_LARGE",
        `Uncompressed ZIP size ${totalUncompressedBytes} exceeds limit ${limits.maxUncompressedBytes}`
      );
    }

    entries.push({
      path: normalizedPath,
      compressedBytes,
      uncompressedBytes,
      directory: normalizedPath.endsWith("/")
    });
    cursor += entryLength;
  }

  if (cursor !== centralOffset + centralSize) {
    malformed("Central directory size does not match parsed entries");
  }

  return {
    entryCount: entries.length,
    totalCompressedBytes,
    totalUncompressedBytes,
    entries
  };
}

function findEocd(bytes: Buffer): number {
  const start = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (offset >= 0 && bytes.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function validateArchivePath(path: string, maxPathLength: number): string {
  if (path.length === 0 || path.includes("\0")) {
    throw new ArchiveValidationError("ILLEGAL_PATH", "ZIP entry has an empty or invalid path");
  }
  if (path.length > maxPathLength) {
    throw new ArchiveValidationError(
      "PATH_TOO_LONG",
      `ZIP entry path length ${path.length} exceeds limit ${maxPathLength}`
    );
  }

  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new ArchiveValidationError("ILLEGAL_PATH", `Illegal ZIP entry path: ${path}`);
  }

  return normalized;
}

function validateLocalHeader(
  bytes: Buffer,
  offset: number,
  centralName: Buffer,
  compressedBytes: number,
  centralOffset: number
): void {
  if (offset >= centralOffset) {
    malformed("Local file header points into the central directory");
  }
  requireRange(bytes, offset, 30);
  if (readUInt32(bytes, offset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    malformed("Invalid local file header signature");
  }
  const fileNameLength = readUInt16(bytes, offset + 26);
  const extraLength = readUInt16(bytes, offset + 28);
  requireRange(bytes, offset, 30 + fileNameLength + extraLength);
  const localName = bytes.subarray(offset + 30, offset + 30 + fileNameLength);
  if (!localName.equals(centralName)) {
    malformed("Local and central directory filenames differ");
  }
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  if (dataOffset + compressedBytes > centralOffset) {
    malformed("ZIP entry data extends into the central directory");
  }
}

function decodePath(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    malformed("ZIP entry filename is not valid UTF-8");
  }
}

function validateLimits(limits: ArchiveValidationLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Archive limit ${name} must be a positive safe integer`);
    }
  }
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    malformed("ZIP size counters overflowed safe integer range");
  }
  return result;
}

function readUInt16(bytes: Buffer, offset: number): number {
  requireRange(bytes, offset, 2);
  return bytes.readUInt16LE(offset);
}

function readUInt32(bytes: Buffer, offset: number): number {
  requireRange(bytes, offset, 4);
  return bytes.readUInt32LE(offset);
}

function requireRange(bytes: Buffer, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    malformed("ZIP structure is truncated or points outside the archive");
  }
}

function malformed(message: string): never {
  throw new ArchiveValidationError("MALFORMED_ARCHIVE", message);
}
