export interface PrivateObjectStore {
  put(key: string, body: Uint8Array, metadata: Readonly<Record<string, string>>): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<readonly PrivateObject[]>;
}

export interface PrivateObject {
  readonly key: string;
  readonly lastModifiedAt: number | undefined;
}
