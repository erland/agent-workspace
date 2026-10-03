export interface StoredObject {
  key: string;
  sizeBytes: number;
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
