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

// Whether client details are masked before text goes to an external AI API
// (PV-01). Anything but the two known values throws, so a typo can't leave
// protection silently off. `optional` (a switch per assessment) comes in PV-07.
export function piiProtectionFrom(value: string | undefined): 'off' | 'required' {
  if (value === undefined || value === '' || value === 'off') return 'off'
  if (value === 'required') return 'required'
  throw new Error(`PII_PROTECTION must be off or required, not "${value}"`)
}

// Whether, with protection on, S5 takes details the AI added out of its answer
// before the reading is saved (PV-04): a name or number read off a photo, which
// was never masked. On unless PII_CHECK_ANSWERS says off; a typo throws.
export function piiCheckAnswersFrom(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'on') return true
  if (value === 'off') return false
  throw new Error(`PII_CHECK_ANSWERS must be on or off, not "${value}"`)
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: requireEnv('MONGODB_URI'),
  jwtSecret: requireEnv('JWT_SECRET'),
  ingestionServiceUrl: requireEnv('INGESTION_SERVICE_URL'),
  ragServiceUrl: requireEnv('RAG_SERVICE_URL'),
  speechOcrServiceUrl: requireEnv('SPEECH_OCR_SERVICE_URL'),
  // Gotenberg, which turns non-PDF uploads into PDFs. Defaults to its local
  // port so an existing .env keeps booting; Compose overrides it.
  converterServiceUrl: process.env.CONVERTER_SERVICE_URL || 'http://localhost:3100',
  awsRegion: requireEnv('AWS_REGION'),
  s3Bucket: requireEnv('S3_BUCKET'),
  redisUrl: requireEnv('REDIS_URL'),
  // USD estimates for Cohere calls (EV-03); Cohere publishes no per-use price.
  prices: {
    // A trial key is free (1,000 calls a month), so its calls cost $0. Trial
    // unless COHERE_KEY_TIER says production; then the estimates below apply.
    cohereKeyTier: (process.env.COHERE_KEY_TIER === 'production' ? 'production' : 'trial') as
      'trial' | 'production',
    cohereEmbedUsdPer1M: Number(process.env.COHERE_EMBED_USD_PER_1M_TOKENS ?? 0.12),
    cohereRerankUsdPer1K: Number(process.env.COHERE_RERANK_USD_PER_1K_SEARCHES ?? 2),
  },
  serviceApiKey: process.env.SERVICE_API_KEY, // for authenticating external api calls
  piiProtection: piiProtectionFrom(process.env.PII_PROTECTION),
  piiCheckAnswers: piiCheckAnswersFrom(process.env.PII_CHECK_ANSWERS),
  // The Chromium the report export prints with (EX-01). Unset, the gateway
  // uses an installed Chrome, else a Chromium installed for Playwright; the
  // Docker image sets it to its own Chromium.
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
  // Where the team works, for the export date in a report's file name (EX-01).
  reportTimeZone: process.env.REPORT_TIME_ZONE || 'Asia/Singapore',
  // Where the browser app is served; the emailed reset (F-06) and invitation
  // (F-08) links point here.
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  // Optional on purpose: CI and fresh checkouts have no mail server, so with
  // no SMTP_HOST emails fall back to the console (mail.service.ts).
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? 'no-reply@marsh-risk-report.example',
  },
}
