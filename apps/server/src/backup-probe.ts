import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

export interface BackupProbe {
  latestBackupAt(): Promise<number | undefined>;
}

export class R2BackupProbe implements BackupProbe {
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
    });
  }

  public async latestBackupAt(): Promise<number | undefined> {
    let continuationToken: string | undefined;
    let latest: number | undefined;
    let pageCount = 0;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: 'litestream/jcb.sqlite/',
          MaxKeys: 1_000,
          ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
        }),
      );
      for (const object of response.Contents ?? []) {
        const modified = object.LastModified?.getTime();
        if (modified !== undefined && (latest === undefined || modified > latest)) {
          latest = modified;
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      pageCount += 1;
      if (pageCount > 100) {
        throw new Error('Backup probe exceeded 100 R2 listing pages.');
      }
    } while (continuationToken !== undefined);
    return latest;
  }
}
