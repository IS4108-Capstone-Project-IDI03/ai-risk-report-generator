// Prints the export pages (EX-01) with headless Chromium: the PDF, and for
// the Word file the pages' blocks with pictures of their charts. The pages
// arrive as one HTML document laid out by the browser with Marsh's page
// layout (RV-12), so the PDF matches it page for page (AC3).
//
// The HTML comes from the browser, so it is opened with no way out: page
// scripts are off, a content security policy allows only inline styles and
// data: images and fonts, and every request is refused, so nothing it names
// is fetched. Chromium is launched for each export and closed after it, and
// at most two run at once.
import type { Browser, Page } from 'playwright-core'
import { config } from '../config'
import { extractReport, partTexts } from './export-extract'
import type { ExportModel } from './export-model'

// Chromium is missing or would not start: the gateway is not set up for it.
export class RendererUnavailableError extends Error {
  constructor(
    message = 'The export could not start its PDF engine (Chromium). Install Chrome or set CHROMIUM_PATH on the gateway, then try again.',
  ) {
    super(message)
    this.name = 'RendererUnavailableError'
  }
}

// The pages could not be printed, e.g. they took too long to open.
export class RenderFailedError extends Error {
  constructor(message = 'The report could not be printed. Try exporting again.') {
    super(message)
    this.name = 'RenderFailedError'
  }
}

// Long enough for a report of a hundred pages with its photos.
const RENDER_TIMEOUT_MS = 90_000
const MAX_RENDERS = 2

// Letter at 96 px to the inch, as the pages are laid out.
const PAGE_VIEWPORT = { width: 816, height: 1056 }

// Only what the pages carry inline: their styles, and data: images and fonts.
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'"

// The HTML with the policy first in its head, whatever the page says.
export function withPolicy(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (head) => `${head}${meta}`)
    : `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`
}

// What the browser must never leave in the file (AC10): review flags and
// notes, the engineer's notices and the locked parts' bars. The pages are
// built without them; this only makes sure.
const NOT_IN_REPORT = '.dm-flag, .dm-notice, .dm-locked-bar, .rv-proposal-note'
const REVIEW_CLASSES = ['dm-ai', 'dm-flagged', 'dm-match', 'is-current']

let running = 0
const waiting: (() => void)[] = []
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_RENDERS) await new Promise<void>((resolve) => waiting.push(resolve))
  running += 1
  try {
    return await work()
  } finally {
    running -= 1
    waiting.shift()?.()
  }
}

async function launch(): Promise<Browser> {
  let chromium: typeof import('playwright-core').chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch {
    throw new RendererUnavailableError()
  }
  // Run as root (the gateway's container), Chromium needs its sandbox off.
  const chromiumSandbox = !(process.getuid?.() === 0)
  const attempts = config.chromiumPath
    ? [{ executablePath: config.chromiumPath }]
    : // Installed Chrome first, then a Chromium installed for Playwright.
      [{ channel: 'chrome' }, {}]
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ ...attempt, headless: true, chromiumSandbox })
    } catch {
      // Try the next one.
    }
  }
  throw new RendererUnavailableError()
}

// Opens the pages and runs `work` on them, then closes Chromium.
export async function withExportPage<T>(html: string, work: (page: Page) => Promise<T>) {
  return await slot(async () => {
    const browser = await launch()
    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: PAGE_VIEWPORT,
        // Charts are pictured at twice their size for the Word file (~190 dpi).
        deviceScaleFactor: 2,
        offline: true,
      })
      await context.route('**/*', (route) => route.abort())
      const page = await context.newPage()
      page.setDefaultTimeout(RENDER_TIMEOUT_MS)
      try {
        await page.setContent(withPolicy(html), { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS })
        // Some TypeScript runners (tsx, vitest) wrap functions in a __name
        // helper; the page has none, so the functions sent to it get one.
        await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)')
        await page.evaluate(
          ([selector, classes]) => {
            const doc = (
              globalThis as unknown as {
                document: {
                  querySelectorAll(s: string): ArrayLike<{
                    remove(): void
                    classList: { remove(...c: string[]): void }
                  }>
                }
              }
            ).document
            for (const element of Array.from(doc.querySelectorAll(selector))) element.remove()
            for (const element of Array.from(doc.querySelectorAll('*')))
              element.classList.remove(...classes)
          },
          [NOT_IN_REPORT, REVIEW_CLASSES] as const,
        )
        await page.evaluate(
          () =>
            (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document
              .fonts.ready,
        )
      } catch {
        throw new RenderFailedError()
      }
      return await work(page)
    } finally {
      await browser.close().catch(() => undefined)
    }
  })
}

// The text of each part, for the placeholder check (AC9).
export const textsOf = (page: Page) => page.evaluate(partTexts)

// The PDF (AC3, AC4): Letter pages as the HTML sizes them, its backgrounds
// (the navy cover, the rank colours), fonts embedded (Chromium always embeds
// them), its headings as bookmarks and its contents as links.
export async function printPdf(page: Page): Promise<Buffer> {
  try {
    return await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      outline: true,
      tagged: true,
    })
  } catch {
    throw new RenderFailedError()
  }
}

export type ReadReport = {
  model: ExportModel
  // Each image of model.images, in order: a PNG picture of a chart or
  // legend, or a photo as the export embedded it.
  pictures: { data: Buffer; type: 'png' | 'jpg' }[]
}

// The pages' blocks for the Word file (AC5-AC8), with a picture of each
// chart and legend, taken as the page draws it.
export async function readReport(page: Page): Promise<ReadReport> {
  let model: ExportModel
  try {
    model = await page.evaluate(extractReport)
  } catch {
    throw new RenderFailedError('The report could not be read for the Word file. Try again.')
  }
  const pictures: ReadReport['pictures'] = []
  for (const image of model.images) {
    if (image.source === 'data') {
      const match = /^data:image\/(jpeg|png);base64,(.*)$/s.exec(image.dataUrl)
      pictures.push({
        data: Buffer.from(match?.[2] ?? '', 'base64'),
        type: match?.[1] === 'png' ? 'png' : 'jpg',
      })
    } else {
      try {
        pictures.push({
          data: await page.locator(image.selector).screenshot({ type: 'png' }),
          type: 'png',
        })
      } catch {
        throw new RenderFailedError('A chart could not be drawn for the Word file. Try again.')
      }
    }
  }
  return { model, pictures }
}
