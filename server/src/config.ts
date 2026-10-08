import path from 'path'
import dotenv from 'dotenv'

// Single .env at the repo root — the same file docker-compose feeds each
// service. Resolved from __dirname, not cwd, so scripts work from anywhere.
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

// Typed env loader. Throws at startup if a required var is missing — the
// server must never silently boot with a broken config.
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: requireEnv('MONGODB_URI'),
  jwtSecret: requireEnv('JWT_SECRET'),
  ingestionServiceUrl: requireEnv('INGESTION_SERVICE_URL'),
  ragServiceUrl: requireEnv('RAG_SERVICE_URL'),
  speechOcrServiceUrl: requireEnv('SPEECH_OCR_SERVICE_URL'),
  awsRegion: requireEnv('AWS_REGION'),
  s3Bucket: requireEnv('S3_BUCKET'),
  redisUrl: requireEnv('REDIS_URL'),
  // USD estimates for Cohere calls (EV-03); Cohere publishes no per-use price.
  prices: {
    cohereEmbedUsdPer1M: Number(process.env.COHERE_EMBED_USD_PER_1M_TOKENS ?? 0.12),
    cohereRerankUsdPer1K: Number(process.env.COHERE_RERANK_USD_PER_1K_SEARCHES ?? 2),
  },
  serviceApiKey: process.env.SERVICE_API_KEY, // for authenticating external api calls
}
