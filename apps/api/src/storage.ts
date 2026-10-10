import {
  CreateBucketCommand, DeleteBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command,
  PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';

// Photos, vendor bills and order PDFs live in S3-compatible object storage, one private bucket
// per customer. Nothing is public: files are read back through the API, which checks permissions.

let client: S3Client | undefined;
function s3() {
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    region: process.env.S3_REGION ?? 'ap-south-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? 'local', secretAccessKey: process.env.S3_SECRET_KEY ?? 'local' },
  });
  return client;
}

export const bucketFor = (customerCode: string) => `${process.env.S3_BUCKET_PREFIX ?? 'fnb'}-${customerCode.replace(/_/g, '-')}`;

const ready = new Set<string>();
async function ensureBucket(bucket: string) {
  if (ready.has(bucket)) return;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3().send(new CreateBucketCommand({ Bucket: bucket }));
  }
  ready.add(bucket);
}

export async function putObject(customerCode: string, key: string, body: Buffer, contentType: string) {
  const Bucket = bucketFor(customerCode);
  await ensureBucket(Bucket);
  await s3().send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(customerCode: string, key: string) {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucketFor(customerCode), Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

// Used when a customer leaves: empty and remove their bucket.
export async function deleteBucket(customerCode: string) {
  const Bucket = bucketFor(customerCode);
  try {
    for (;;) {
      const list = await s3().send(new ListObjectsV2Command({ Bucket }));
      if (!list.Contents?.length) break;
      await s3().send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: list.Contents.map((o) => ({ Key: o.Key! })) } }));
    }
    await s3().send(new DeleteBucketCommand({ Bucket }));
  } catch {
    // no bucket: nothing to remove
  }
  ready.delete(Bucket);
}
