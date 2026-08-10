export interface PrivateObjectStore {
  put(key: string, body: Uint8Array, metadata: Readonly<Record<string, string>>): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
}
