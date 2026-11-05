// The export's printing (EX-01) in a real Chromium: the PDF of laid-out
// pages, the Word file read from the same pages, and the page opened with no
// way out. Skipped where no Chrome or Chromium is installed (set
// CHROMIUM_PATH, or install Chrome).
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildDocx } from '../services/export-docx'
import {
  printPdf,
  readReport,
  RendererUnavailableError,
  textsOf,
  withExportPage,
  withPolicy,
} from '../services/export-render.service'

// A 2×2 PNG, for a photo already at print resolution.
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='

const page = (n: number, inner: string) =>
  `<section class="pg-page" data-export-page="body" style="position:relative;width:612pt;height:792pt;overflow:hidden;break-after:page"><div class="dm-prose" style="padding:72pt 70.85pt 0">${inner}</div><p style="position:absolute;bottom:28pt;right:70.85pt;margin:0">${n}</p></section>`

const PAGES = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>RPT-2026-0411</title>
<style>@page { size: 612pt 792pt; margin: 0 } body { margin: 0; font-family: Arial, 'Liberation Sans', sans-serif; font-size: 11pt }</style>
<script>document.documentElement.setAttribute('data-ran', 'yes')</script></head><body>
<section data-export-page="contents" style="width:612pt;height:792pt;break-after:page">
  <a href="#x-s-7" data-x-toc="1"><span class="pg-toc-number">7.</span><span class="pg-toc-title">Construction</span><span class="pg-toc-page">1</span></a>
  <a href="#x-toc-1" data-x-toc="2"><span class="pg-toc-title">Construction Narrative</span><span class="pg-toc-page">1</span></a>
</section>
${page(
  1,
  `<section data-x-section="Section 7. Construction">
     <h2 id="x-s-7" data-x-title="Construction" data-x-number="7." data-x-kicker="Section 7" data-x-toc="1">Construction</h2>
     <h3 id="x-toc-1" data-x-toc="2">Construction Narrative</h3>
     <p>The roof is <strong>steel</strong> deck.<sup data-x-cite="1">1</sup></p>
     <img src="http://127.0.0.1:9/tracker.png" alt="">
     <table data-x="x1"><thead><tr><th>Item</th><th>Rank</th></tr></thead>
       <tbody><tr><td>Housekeeping</td><td style="background:#ffc100">Established</td></tr></tbody></table>
   </section>`,
)}
${page(
  2,
  `<section data-x-section="Section 7. Construction">
     <table data-x="x1"><thead data-x-repeat><tr><th>Item</th><th>Rank</th></tr></thead>
       <tbody><tr><td>Hot work</td><td>Formalized</td></tr></tbody></table>
     <figure data-x-kind="image" style="margin:0;width:200px;height:100px"><svg width="200" height="100"><rect width="120" height="80" fill="#002c77"/></svg></figure>
     <figure data-x-kind="photo" style="margin:0"><img src="${PHOTO}" style="width:40px;height:40px" alt="Pump room"><figcaption>Pump room</figcaption></figure>
     <p class="rv-sr-only" data-x-skip>For screen readers only.</p>
   </section>`,
)}
</body></html>`

// Runs the test with Chromium, or skips it where there is none.
async function orSkip<T>(skip: () => void, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof RendererUnavailableError) {
      skip()
      return undefined
    }
    throw error
  }
}

describe('the export page (EX-01)', () => {
  it('puts the content security policy first in the page', () => {
    expect(withPolicy('<html><head><title>x</title></head></html>')).toMatch(
      /^<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none';/,
    )
    expect(withPolicy('<p>bare</p>')).toContain('Content-Security-Policy')
  })

  it('opens the pages with page scripts off and every request refused', async (context) => {
    const seen = await orSkip(context.skip, () =>
      withExportPage(PAGES, (p) =>
        p.evaluate(() => {
          const doc = (
            globalThis as unknown as {
              document: {
                documentElement: { getAttribute(n: string): string | null }
                querySelector(s: string): { naturalWidth: number } | null
              }
            }
          ).document
          return {
            ran: doc.documentElement.getAttribute('data-ran'),
            tracker: doc.querySelector('img[src^="http"]')?.naturalWidth ?? -1,
          }
        }),
      ),
    )
    if (!seen) return
    expect(seen.ran).toBeNull()
    expect(seen.tracker).toBe(0)
  })

  it('reads the text of each part, for the placeholder check (AC9)', async (context) => {
    const texts = await orSkip(context.skip, () => withExportPage(PAGES, textsOf))
    if (!texts) return
    const section = texts.find((t) => t.part === 'Section 7. Construction')
    expect(section?.text).toContain('The roof is steel deck.')
    expect(section?.text).toContain('Hot work')
  })

  it('prints Letter pages with bookmarks, contents links and embedded fonts (AC3, AC4)', async (context) => {
    const pdf = await orSkip(context.skip, () => withExportPage(PAGES, printPdf))
    if (!pdf) return
    const text = pdf.toString('latin1')
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(3)
    expect(text).toContain('/MediaBox [0 0 612 792]')
    expect(text).toContain('/Outlines')
    expect(text).toContain('/Subtype /Link')
    expect(text).toMatch(/\/FontFile2/)
  })

  it('reads the pages into the Word file: a table carried across pages is one (AC5, AC7)', async (context) => {
    const read = await orSkip(context.skip, () => withExportPage(PAGES, readReport))
    if (!read) return
    const { model, pictures } = read
    const kinds = model.blocks.map((b) => b.kind)
    expect(kinds).toEqual(['section', 'heading', 'paragraph', 'table', 'image', 'image'])
    const table = model.blocks.find((b) => b.kind === 'table')!
    if (table.kind !== 'table') throw new Error('no table')
    // The header once, then the rows from both pages; the rank keeps its colour.
    expect(table.headerRows).toBe(1)
    expect(table.rows.map((r) => r.map((c) => c.paragraphs[0]?.runs[0]?.text))).toEqual([
      ['Item', 'Rank'],
      ['Housekeeping', 'Established'],
      ['Hot work', 'Formalized'],
    ])
    expect(table.rows[1][1].fill).toBe('#ffc100')
    // The citation is a superscript number.
    const paragraph = model.blocks.find((b) => b.kind === 'paragraph')!
    if (paragraph.kind !== 'paragraph') throw new Error('no paragraph')
    expect(paragraph.paragraph.runs).toEqual([
      { text: 'The roof is ' },
      { text: 'steel', bold: true },
      { text: ' deck.' },
      { text: '1', superscript: true },
    ])
    // The chart is pictured; the photo is the one the export embedded.
    expect(pictures.map((p) => p.type)).toEqual(['png', 'png'])
    expect(pictures[0].data.subarray(1, 4).toString()).toBe('PNG')
    expect(model.contents).toEqual([
      { level: 1, number: '7.', title: 'Construction', page: 1, anchor: 'x-s-7' },
      { level: 2, number: '', title: 'Construction Narrative', page: 1, anchor: 'x-toc-1' },
    ])

    const docx = await buildDocx(model, pictures, {
      reference: 'RPT-2026-0411',
      client: 'Northgate Logistics',
      site: 'Tilbury Distribution Centre',
      address: null,
      assessmentType: 'Property risk survey',
      visitDate: '11 April 2026',
      engineer: 'Alex Rowe',
    })
    const zip = await JSZip.loadAsync(docx)
    // The cover's navy, the chart and the photo.
    const media = Object.keys(zip.files).filter((f) => /^word\/media\/.+/.test(f))
    expect(media).toHaveLength(3)
  })

  it("keeps an OFI record's text and photos in its cell (AC5, AC8)", async (context) => {
    const html = `<!doctype html><html><head><style>body { font: 11pt Arial, sans-serif }</style></head><body>
      ${page(
        1,
        `<table class="rv-ofi-table"><tbody><tr><th>Observation</th>
        <td>Hot work near racking.<span style="display:flex;gap:8px"><img src="${PHOTO}" style="width:60px;height:60px" alt=""></span></td>
      </tr></tbody></table>`,
      )}</body></html>`
    const read = await orSkip(context.skip, () => withExportPage(html, readReport))
    if (!read) return
    const table = read.model.blocks[0]
    if (table.kind !== 'table') throw new Error('no table')
    const cell = table.rows[0][1]
    expect(cell.paragraphs.map((p) => p.runs.map((r) => (r.image ? 'photo' : r.text)))).toEqual([
      ['Hot work near racking.'],
      ['photo'],
    ])
    expect(read.pictures).toHaveLength(1)
    const docx = await buildDocx(read.model, read.pictures, {
      reference: 'RPT-2026-0411',
      client: null,
      site: null,
      address: null,
      assessmentType: null,
      visitDate: null,
      engineer: null,
    })
    const zip = await JSZip.loadAsync(docx)
    expect(await zip.file('word/document.xml')!.async('string')).toContain('Hot work near racking.')
  })
})
