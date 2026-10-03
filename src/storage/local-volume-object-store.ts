import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import type { ObjectStore, StoredObject } from "./object-store.js";

export class LocalVolumeObjectStore implements ObjectStore {
  private readonly root: string;

  public constructor(root = process.env.AGENT_WORKSPACE_STORAGE_DIR ?? "/data") {
    this.root = resolve(root);
  }

  public async put(key: string, bytes: Uint8Array): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return { key, sizeBytes: bytes.byteLength };
  }

  public async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  public async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  public async deletePrefix(prefix: string): Promise<void> {
    await rm(this.pathFor(prefix), { recursive: true, force: true });
  }

  public async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  private pathFor(key: string): string {
    if (!key || key.startsWith("/") || key.includes("\0")) throw new Error("Invalid storage key");
    const normalizedKey = normalize(key.replaceAll("\\", "/")).replace(/^\.\//, "");
    if (normalizedKey === ".." || normalizedKey.startsWith("../")) throw new Error("Invalid storage key");
    const path = resolve(join(this.root, normalizedKey));
    if (path !== this.root && !path.startsWith(this.root + "/")) throw new Error("Storage key escapes root");
    return path;
  }
}
