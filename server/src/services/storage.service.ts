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

export async function getObjectStream(key: string): Promise<Readable> {
  const result = await s3.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }))
  return result.Body as Readable
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }))
}
