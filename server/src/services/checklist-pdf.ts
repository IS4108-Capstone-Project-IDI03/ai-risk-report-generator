// The pre-survey checklist as a PDF to take on site (CP-32 AC4-5): every item
// still on the checklist, in the tab's order (the priority risks, then each
// report section by subsection), with whether it has been answered, each
// reference's standard, edition, page and quoted words, and room to tick and
// write on site. Called by checklist.service, which prints it with
// export-render.service's Chromium: the page is built here from the saved
// checklist, never from the browser, and names nothing to fetch, so it reads
// the same without a network.
import { config } from '../config'
import type { ChecklistDto } from './checklist.service'

type Item = ChecklistDto['items'][number]
type Source = {
  text?: string
  doc_id?: string | null
  page_start?: number | null
  page_end?: number | null
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
// A string inside CSS `content: "…"`, in a <style> element.
const cssString = (text: string) => `"${text.replace(/["\\\n<>]/g, ' ')}"`

// "3 November 2026", where the team works (REPORT_TIME_ZONE).
const day = (date: Date | string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: config.reportTimeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date))

function country(code: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

const RESULT: Record<string, string> = {
  confirmed: 'Confirmed',
  differs: 'Differs',
  not_seen: 'Not seen',
  not_applicable: 'Not applicable',
}

// The page: A4, which engineers print on, with the reference and page number
// in the margin of every page.
const style = (footer: string) => `
@page {
  size: A4;
  margin: 16mm 15mm 18mm;
  @bottom-left { content: ${footer}; font: 7.5pt Arial, 'Liberation Sans', sans-serif; color: #555 }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt Arial, 'Liberation Sans', sans-serif; color: #555 }
}
* { box-sizing: border-box }
body { margin: 0; font: 9.5pt/1.4 Arial, 'Liberation Sans', sans-serif; color: #111 }
h1 { font-size: 17pt; margin: 0 0 6pt }
h2 { font-size: 13pt; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #111; break-after: avoid }
h3 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid }
p { margin: 0 }
table.details { border-collapse: collapse; margin: 6pt 0 10pt }
table.details th { text-align: left; font-weight: normal; color: #555; padding: 1pt 12pt 1pt 0; vertical-align: top }
table.details td { padding: 1pt 0 }
.note { color: #444; font-size: 8.5pt }
.label { font-size: 7.5pt; font-weight: bold; letter-spacing: 0.06em; text-transform: uppercase; color: #555; margin: 8pt 0 2pt; break-after: avoid }
.item { display: flex; gap: 6pt; padding: 6pt 0; border-top: 0.5pt solid #bbb; break-inside: avoid }
.n { flex: 0 0 22pt; font-weight: bold; color: #555 }
.body { flex: 1 1 auto; min-width: 0 }
.title { font-weight: normal }
.template .title { font-weight: bold }
.under { padding-left: 14pt }
.meta { color: #555; font-size: 8pt; margin-top: 1pt }
.tag { display: inline-block; border: 0.5pt solid #777; border-radius: 2pt; padding: 0 3pt; font-size: 7pt; margin-left: 4pt; vertical-align: 1pt }
.refs { margin: 3pt 0 0; padding: 0; list-style: none }
.refs li { margin-top: 2pt; padding-left: 6pt; border-left: 1.5pt solid #999; font-size: 8.5pt }
.quote { font-style: italic }
.warn { color: #8a4b00 }
.boxes { display: flex; flex-wrap: wrap; gap: 3pt 12pt; margin-top: 4pt; font-size: 8.5pt }
.box { display: inline-block; width: 8pt; height: 8pt; border: 0.75pt solid #111; margin-right: 3pt; vertical-align: -1pt }
.line { height: 14pt; border-bottom: 0.5pt solid #999 }
.answered { margin-top: 4pt; font-size: 8.5pt }
.answered b { border: 0.75pt solid #111; border-radius: 2pt; padding: 0 3pt }
`

// "NFPA 13 Standard for the Installation of Sprinkler Systems, 2025 edition,
// p. 118", from what the checklist kept of the standard and the passage.
function referenceName(checklist: ChecklistDto, source: Source | undefined) {
  const standard = checklist.standards.find((s) => s.id === source?.doc_id)
  const pages =
    source?.page_start == null
      ? null
      : source.page_end != null && source.page_end !== source.page_start
        ? `pp. ${source.page_start}–${source.page_end}`
        : `p. ${source.page_start}`
  return [
    standard?.title ?? 'Standard',
    standard?.edition ? `${standard.edition} edition` : null,
    pages,
  ]
    .filter(Boolean)
    .join(', ')
}

function references(checklist: ChecklistDto, item: Item) {
  if (!item.citations.length) {
    return item.flags.includes('uncited') ? '<p class="meta">No standard cited.</p>' : ''
  }
  const sources = checklist.sources as Record<string, Source>
  const rows = item.citations.map(
    (c) =>
      `<li>${escape(referenceName(checklist, sources[c.ref]))}: <span class="quote">“${escape(c.quote)}”</span>` +
      (c.quoteFound
        ? ''
        : c.quoteDescribed
          ? // Only in a picture's AI description (KB-02): cited, never found.
            ` <span class="note">(from the AI's reading of the figure: check the figure)</span>`
          : ' <span class="warn">(not word for word in the passage: verify before use)</span>') +
      '</li>',
  )
  return `<ul class="refs">${rows.join('')}</ul>`
}

// How it was answered, or the boxes to tick and lines to write on.
function answer(item: Item) {
  const check = item.check
  if (check) {
    const where = [check.by, check.observation?.location, day(check.at)].filter(Boolean)
    return `<p class="answered"><b>${escape(RESULT[check.result] ?? check.result)}</b> ${escape(where.join(' · '))}</p>`
  }
  const boxes = Object.values(RESULT)
    .map((label) => `<span><span class="box"></span>${label}</span>`)
    .join('')
  return `<div class="boxes">${boxes}</div><div class="line"></div><div class="line"></div>`
}

function itemBlock(checklist: ChecklistDto, item: Item, n: number, under = false) {
  const template = item.origin === 'template'
  const title = template && item.subsection ? item.subsection : item.text
  // "Walls, roof, frame and floors. Covers: Roof, Walls."
  const detail = [
    template && item.text !== item.subsection ? item.text.replace(/([^.!?])$/, '$1.') : '',
    template && item.fields.length ? `Covers: ${item.fields.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  // Only the model's items are AI-written (CP-30 AC8), until the engineer edits them.
  const tag =
    item.origin === 'manual'
      ? 'Added'
      : item.edited
        ? 'Edited'
        : item.origin === 'standard' || item.origin === 'hazard'
          ? 'AI-written'
          : null
  const meta = [item.COPE_dimension.join(', ')].filter(Boolean).join(' · ')
  return (
    `<div class="item${template ? ' template' : ''}${under ? ' under' : ''}">` +
    `<div class="n">${n}</div><div class="body">` +
    `<p class="title">${escape(title)}${tag ? `<span class="tag">${tag}</span>` : ''}</p>` +
    (detail ? `<p class="note">${escape(detail)}</p>` : '') +
    (meta ? `<p class="meta">${escape(meta)}</p>` : '') +
    // CP-34 adds the pre-filled value here, labelled as reported, with its source.
    references(checklist, item) +
    answer(item) +
    '</div></div>'
  )
}

export function checklistPdfHtml(input: {
  reference: string
  client: string | null
  site: string
  visitDate: Date | null
  checklist: ChecklistDto
  printedAt: Date
}) {
  const { checklist } = input
  const items = checklist.items.filter((i) => i.status !== 'removed')
  let n = 0
  const block = (item: Item, under = false) => itemBlock(checklist, item, ++n, under)
  const parts: string[] = []

  if (checklist.hazards.length) {
    parts.push('<h2>Priority risks</h2>')
    for (const hazard of checklist.hazards) {
      const of = items.filter((i) => i.area === 'hazards' && i.hazard === hazard.id)
      if (!of.length) continue
      parts.push(`<h3>${escape(hazard.name)}</h3>`)
      if (hazard.inScope.length) {
        parts.push(`<p class="note">Checked against ${escape(hazard.standards.join(', '))}.</p>`)
      }
      parts.push(...of.map((i) => block(i)))
    }
  }

  parts.push('<h2>Report sections</h2>')
  for (const area of checklist.areas) {
    const of = items.filter((i) => i.area === area.id)
    if (!of.length) continue
    parts.push(`<h3>${escape(`${area.id}. ${area.title}`)}</h3>`)
    const rows = of.filter((i) => i.origin === 'template')
    const general = of.filter(
      (i) => i.origin !== 'template' && !rows.some((r) => r.subsection === i.subsection),
    )
    if (general.length) {
      parts.push('<p class="label">General</p>', ...general.map((i) => block(i)))
    }
    for (const row of rows) {
      parts.push(block(row))
      parts.push(
        ...of
          .filter((i) => i.origin !== 'template' && i.subsection === row.subsection)
          .map((i) => block(i, true)),
      )
    }
  }

  const details: [string, string | null][] = [
    ['Assessment', input.reference],
    ['Client', input.client],
    ['Site', input.site],
    ['Facility type', checklist.facilityType],
    ['Country', country(checklist.jurisdiction)],
    ['Site visit', input.visitDate ? day(input.visitDate) : null],
    ['Checklist generated', day(checklist.provenance.generated_at)],
    ['Printed', day(input.printedAt)],
  ]
  const standards = checklist.standards.length
    ? `<p class="label">Standards used</p><p class="note">${checklist.standards
        .map((s) =>
          escape([s.title, s.edition && `${s.edition} edition`].filter(Boolean).join(', ')),
        )
        .join('<br>')}</p>`
    : '<p class="note">No standards were selected: the items come from the report template and the facility type.</p>'
  const footer = cssString(`${input.reference} · Pre-survey checklist`)

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escape(input.reference)} pre-survey checklist</title>
<style>${style(footer)}</style></head><body>
<h1>Pre-survey checklist</h1>
<table class="details">${details
    .filter(([, value]) => value)
    .map(([name, value]) => `<tr><th>${name}</th><td>${escape(value!)}</td></tr>`)
    .join('')}</table>
${standards}
<p class="note" style="margin-top:6pt">Tick one box for each item and note what you saw. Items already answered in the app show their answer. Record what you find in the app afterwards: this copy is not read back. AI-written items rest on the quoted words; check them against the standard.</p>
${parts.join('\n')}
</body></html>`
}
