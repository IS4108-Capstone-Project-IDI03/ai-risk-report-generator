// The demo seed's steps that go through the running app, as a user would: signing in to the
// gateway's API, and exporting a finished report from the real Export tab in headless Chromium
// (EX-01), so the PDF is the one the app makes. Called by seed-demo.ts and seed-demo-ai.ts.
// Needs the stack running (`docker compose up`); makes no AI call itself.
import { lookup } from 'node:dns/promises'
import { readFile } from 'node:fs/promises'
import { config } from '../config'
import { pdfPageCount } from '../services/assistant/brief.service'
import { SEED_PASSWORD } from './seed-demo-data'

// The gateway, from inside its own container or on the host (`npm run dev`).
const GATEWAY = process.env.SEED_GATEWAY_URL ?? `http://localhost:${config.port}`

/** Returns the client's address. In Docker the client is another container: Vite answers
 * its IP but refuses an unknown host name such as `client`, so the name is looked up. */
async function appUrl(): Promise<string> {
  if (process.env.SEED_APP_URL) return process.env.SEED_APP_URL
  try {
    return `http://${(await lookup('client')).address}:3000`
  } catch {
    return 'http://localhost:3000'
  }
}

// One signed-in user of the gateway's API: the same requests the browser makes.
export class Gateway {
  private cookie = ''
  constructor(readonly email: string) {}

  /** Signs in with the seed password; returns this user's session. */
  async signIn(): Promise<this> {
    const res = await fetch(`${GATEWAY}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: SEED_PASSWORD }),
    })
    if (!res.ok) throw new Error(`Signing in as ${this.email} failed (${res.status}).`)
    this.cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    return this
  }

  /** Returns the JSON answer of one API request; throws with the gateway's reason otherwise. */
  async call<T = unknown>(method: string, path: string, body?: object | FormData): Promise<T> {
    const form = body instanceof FormData
    const res = await fetch(`${GATEWAY}/api${path}`, {
      method,
      headers: {
        cookie: this.cookie,
        ...(body && !form && { 'content-type': 'application/json' }),
      },
      body: form ? body : body && JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`)
    return (text ? JSON.parse(text) : undefined) as T
  }
}

/** Returns a file of seed-media/ as a form part. */
export async function mediaFile(name: string, type: string): Promise<Blob> {
  return new Blob([await readFile(`${__dirname}/seed-media/${name}`)], { type })
}

/**
 * Exports `reference` as a PDF from its Export tab, signed in as `email` (only the assigned
 * engineer can), and returns the downloaded file's name and page count. Throws when the tab
 * shows anything left to finish or the file is not a PDF.
 */
export async function exportInBrowser(email: string, reference: string) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({
    headless: true,
    ...(config.chromiumPath && { executablePath: config.chromiumPath }),
    // Run as root (the gateway's container), Chromium needs its sandbox off.
    chromiumSandbox: process.getuid?.() !== 0,
  })
  try {
    const app = await appUrl()
    const page = await browser.newPage({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
    })
    page.setDefaultTimeout(60_000)
    await page.goto(`${app}/`)
    await page.getByRole('textbox', { name: 'Work email' }).fill(email)
    await page.getByRole('textbox', { name: 'Password' }).fill(SEED_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((url) => url.pathname !== '/', { timeout: 30_000 })
    await page.goto(`${app}/assessment?ref=${reference}&tab=export`)
    // Without this wait the button can still be greyed out while the check loads.
    await page.getByText('Nothing left to finish').waitFor()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180_000 }),
      page.getByRole('button', { name: 'Export as PDF' }).click(),
    ])
    const file = await readFile((await download.path())!)
    if (file.subarray(0, 5).toString() !== '%PDF-')
      throw new Error(`${reference}'s export is not a PDF.`)
    return { fileName: download.suggestedFilename(), pages: pdfPageCount(file) }
  } finally {
    await browser.close()
  }
}
