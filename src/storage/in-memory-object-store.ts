import type { ObjectStore, StoredObject } from "./object-store.js";

export class InMemoryObjectStore implements ObjectStore {
  private readonly values = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array): Promise<StoredObject> {
    this.values.set(key, new Uint8Array(bytes));
    return { key, sizeBytes: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const value = this.values.get(key);
    if (!value) throw new Error(`Stored object not found: ${key}`);
    return new Uint8Array(value);
  }

  async delete(key: string): Promise<void> { this.values.delete(key); }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key);
  }

  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}
