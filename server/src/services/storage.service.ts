import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { Readable } from 'stream'
import { config } from '../config'

// Original uploaded files live in S3; MongoDB keeps only their keys.
// Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, which the
// SDK reads itself.
const s3 = new S3Client({ region: config.awsRegion })

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

// Bytes start..end of a file, both included.
export type ByteRange = { start: number; end: number }

// Returns the file as a stream, or only the bytes in `range`.
export async function getObjectStream(key: string, range?: ByteRange): Promise<Readable> {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      ...(range && { Range: `bytes=${range.start}-${range.end}` }),
    }),
  )
  return result.Body as Readable
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }))
}
