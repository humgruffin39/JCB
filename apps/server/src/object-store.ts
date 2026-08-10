import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PrivateObjectStore } from '@jcb/application';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';

export class R2PrivateObjectStore implements PrivateObjectStore {
  private readonly client: S3Client;

  public constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly bucket: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  public async put(
    key: string,
    body: Uint8Array,
    metadata: Readonly<Record<string, string>>,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        Metadata: { ...metadata },
      }),
    );
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return response.Body === undefined ? undefined : await response.Body.transformToByteArray();
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}

export class FilePrivateObjectStore implements PrivateObjectStore {
  private readonly absoluteRoot: string;

  public constructor(root: string) {
    this.absoluteRoot = resolve(root);
  }

  public async put(
    key: string,
    body: Uint8Array,
    metadata: Readonly<Record<string, string>>,
  ): Promise<void> {
    void metadata;
    const path = this.safePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(this.safePath(key));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private safePath(key: string): string {
    const path = resolve(join(this.absoluteRoot, normalize(key)));
    if (!path.startsWith(`${this.absoluteRoot}\\`) && path !== this.absoluteRoot) {
      throw new Error('Object key escapes the private store root.');
    }
    return path;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    ('code' in error || '$metadata' in error) &&
    (('code' in error && error.code === 'ENOENT') ||
      ('$metadata' in error &&
        typeof error.$metadata === 'object' &&
        error.$metadata !== null &&
        'httpStatusCode' in error.$metadata &&
        error.$metadata.httpStatusCode === 404))
  );
}
