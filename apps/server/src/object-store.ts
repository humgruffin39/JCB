import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { PrivateObjectStore } from '@jcb/application';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

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

  public async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  public async list(
    prefix: string,
  ): Promise<readonly { key: string; lastModifiedAt: number | undefined }[]> {
    let continuationToken: string | undefined;
    const objects: Array<{ key: string; lastModifiedAt: number | undefined }> = [];
    let pageCount = 0;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 1_000,
          ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key === undefined) continue;
        objects.push({
          key: object.Key,
          lastModifiedAt: object.LastModified?.getTime(),
        });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      pageCount += 1;
      if (pageCount > 100) throw new Error('Object listing exceeded 100 R2 pages.');
    } while (continuationToken !== undefined);
    return objects;
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

  public async delete(key: string): Promise<void> {
    try {
      await unlink(this.safePath(key));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  public async list(
    prefix: string,
  ): Promise<readonly { key: string; lastModifiedAt: number | undefined }[]> {
    const root = prefix.length === 0 ? this.absoluteRoot : this.safePath(prefix);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const objects: Array<{ key: string; lastModifiedAt: number | undefined }> = [];
    for (const entry of entries) {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) {
        const nestedPrefix = relative(this.absoluteRoot, path).replaceAll('\\', '/');
        objects.push(...(await this.list(nestedPrefix)));
        continue;
      }
      if (!entry.isFile()) continue;
      const metadata = await stat(path);
      objects.push({
        key: relative(this.absoluteRoot, path).replaceAll('\\', '/'),
        lastModifiedAt: metadata.mtimeMs,
      });
    }
    return objects;
  }

  private safePath(key: string): string {
    const segments = key.replaceAll('\\', '/').split('/');
    const path = resolve(this.absoluteRoot, ...segments);
    const relativePath = relative(this.absoluteRoot, path);
    if (
      key.length === 0 ||
      relativePath === '..' ||
      relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(relativePath)
    ) {
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
