import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { SiteModel } from '../models/site.model'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// CP-37 (simple checklist): the choices before generating, the tick/cross/not-seen marks, and
// adding an item under a new section.
// S4 is a stubbed fetch; nothing is paid.
useMemoryMongo()

const engineer = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, engineer)
const admin = signedInAsRole(app, 'knowledge_admin', 'Sana')
const REFERENCE = 'RPT-2026-0517'
const url = `/api/assessments/${REFERENCE}/checklist`
const SETTINGS = '/api/settings/checklist'
const TYPE = 'Distribution warehouse'

const drafts = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const standardItem = {
  area: '7',
  subsection: 'Construction Narrative',
  origin: 'template',
  hazard: null,
  text: 'Walls, roof, frame and floors',
  fields: [],
  COPE_dimension: ['Construction'],
  citations: [],
  flags: [],
}
const pastItem = {
  area: '8',
  subsection: null,
  origin: 'past_report',
  hazard: null,
  text: 'Is the fire pump tested weekly?',
  fields: [],
  COPE_dimension: ['Protection'],
  citations: [{ ref: 'P:rep1:4', quote: 'pump not tested weekly', quote_found: true }],
  flags: [],
}
const reply = (items: object[], noPast: boolean) => ({
  items,
  areas: [
    { id: '7', title: 'Construction' },
    { id: '8', title: 'Protection' },
  ],
  hazards: [],
  sources: {
    'P:rep1:4': { text: 'pump not tested weekly', title: 'Tuas DC 2024', doc_id: 'rep1' },
  },
  no_past_reports: noPast,
  usage: [],
  provenance: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    effort: 'medium',
    prompt_version: 'cp37-v1',
    checklist_version: 'checklist-v1-2026-10',
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: '2026-10-26T06:00:00+00:00',
  },
})

beforeEach(async () => {
  drafts.mockImplementation(() => json(reply([standardItem, pastItem], false)))
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) =>
    u.endsWith('/checklist/draft') ? drafts(JSON.parse(String(init!.body))) : json({}),
  )
  const site = await SiteModel.create({
    code: 'SITE-0517',
    name: 'Tuas DC',
    jurisdiction: 'SG',
    facilityType: TYPE,
  })
  await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'Property risk survey',
    siteVisitDate: new Date('2026-11-03'),
    engineer: engineer._id,
  })
})
afterEach(() => {
  drafts.mockReset()
  vi.unstubAllGlobals()
})

let n = 0
async function marshReport(title: string, labels: Record<string, string> = {}, extra = {}) {
  n += 1
  const d = await KnowledgeDocumentModel.create({
    title,
    issuingBody: 'Marsh',
    fileName: `r${n}.pdf`,
    file: {
      key: `knowledge/r${n}.pdf`,
      contentType: 'application/pdf',
      size: 10,
      sha256: `sha-r${n}`,
    },
    status: 'complete',
    metadata: {
      source_type: 'marsh_report',
      jurisdiction: 'SG',
      facility_type: TYPE,
      effective_date: new Date('2025-01-01'),
      ...labels,
    },
    ...extra,
  })
  return String(d._id)
}
const generate = (body: object = { standardIds: [] }) => api.post(url).send(body)

describe('the choices before generating (CP-37)', () => {
  it('lists the past Marsh reports of the site type and country, and the defaults count', async () => {
    const mine = await marshReport('Tuas DC 2025')
    await marshReport('Any site report', { facility_type: 'all', jurisdiction: 'all' })
    await marshReport('Cold store report', { facility_type: 'Cold store' })
    await marshReport('UK warehouse', { jurisdiction: 'UK' })
    await marshReport(
      'Withdrawn',
      {},
      { withdrawn: { at: new Date(), by: { id: 'a', name: 'S' } } },
    )
    await marshReport('Still ingesting', {}, { status: 'processing' })
    const res = await api.get(url)
    expect(res.body.pastReports.map((r: { title: string }) => r.title).sort()).toEqual([
      'Any site report',
      'Tuas DC 2025',
    ])
    expect(res.body.pastReports.find((r: { title: string }) => r.title === 'Tuas DC 2025').id).toBe(
      mine,
    )
    await admin.post(SETTINGS).send({ facilityType: TYPE, text: 'Roof access locked?' })
    expect((await api.get(url)).body.defaults.count).toBe(1)
  })

  it('sends only the chosen past reports to S4, and none when none are chosen', async () => {
    const a = await marshReport('A')
    await marshReport('B')
    await generate({ standardIds: [], pastReportIds: [a] })
    expect(drafts.mock.calls[0][0].past_report_ids).toEqual([a])
    await generate({ standardIds: [], pastReportIds: [] })
    expect(drafts.mock.calls[1][0].past_report_ids).toEqual([])
    // Left out: S4 uses every matching report, as before.
    await generate({ standardIds: [] })
    expect(drafts.mock.calls[2][0]).not.toHaveProperty('past_report_ids')
  })

  it('refuses a past report that does not match the site', async () => {
    const other = await marshReport('Cold store report', { facility_type: 'Cold store' })
    expect((await generate({ standardIds: [], pastReportIds: [other] })).status).toBe(400)
    expect((await generate({ standardIds: [], pastReportIds: ['nope'] })).status).toBe(400)
  })

  it('leaves out the admin defaults when asked', async () => {
    await admin.post(SETTINGS).send({ facilityType: TYPE, text: 'Roof access locked?' })
    const without = (await generate({ standardIds: [], includeDefaults: false })).body.checklist
    expect(without.items.some((i: { fixed?: boolean }) => i.fixed)).toBe(false)
    const withDefaults = (await generate({ standardIds: [] })).body.checklist
    expect(withDefaults.items.some((i: { fixed?: boolean }) => i.fixed)).toBe(true)
  })
})

describe('tick, cross and not seen (CP-37)', () => {
  const mark = (itemId: string, value: string | null) =>
    api.put(`${url}/items/${itemId}/mark`).send({ mark: value })
  type Marked = { id: string; check: { result: string } | null }
  const find = (res: { body: { checklist: { items: Marked[] } } }, id: string) =>
    res.body.checklist.items.find((i) => i.id === id)!

  it('saves a tick, a cross and not seen as marks, and clears them', async () => {
    const { checklist } = (await generate()).body
    const id = checklist.items[0].id
    for (const value of ['confirmed', 'differs', 'not_seen']) {
      const res = await mark(id, value)
      expect(res.status).toBe(200)
      expect(find(res, id).check?.result).toBe(value)
    }
    expect(find(await mark(id, null), id).check).toBeNull()
    expect((await mark(id, 'maybe')).status).toBe(400)
  })
})

describe('adding an item under a new section (CP-37)', () => {
  const addItem = (body: object) => api.post(`${url}/items`).send(body)

  it('creates the section and puts the item under it, with no category needed', async () => {
    await generate()
    const res = await addItem({
      text: 'Is the loading dock gate locked at night?',
      newSection: 'Security',
    })
    expect(res.status).toBe(201)
    const { checklist } = res.body
    const section = checklist.areas.find((a: { title: string }) => a.title === 'Security')
    expect(section).toBeTruthy()
    const item = checklist.items.find((i: { id: string }) => i.id === res.body.itemId)
    expect(item).toMatchObject({ area: section.id, origin: 'manual' })
    // A second item for the same name joins the same section.
    const again = await addItem({ text: 'Is CCTV working?', newSection: 'security' })
    expect(
      again.body.checklist.areas.filter((a: { title: string }) => /security/i.test(a.title)),
    ).toHaveLength(1)
  })

  it("keeps the engineer's own section, with its items, when generated again", async () => {
    await generate()
    await addItem({ text: 'Is CCTV working?', newSection: 'Security' })
    const again = (await generate()).body.checklist
    const section = again.areas.find((a: { title: string }) => a.title === 'Security')
    expect(section).toBeTruthy()
    expect(
      again.items.filter((i: { area: string; text: string }) => i.area === section.id),
    ).toHaveLength(1)
  })

  it('adds to an existing section without a category, and refuses neither or both', async () => {
    await generate()
    expect((await addItem({ text: 'Walls checked?', area: '7' })).status).toBe(201)
    expect((await addItem({ text: 'No place' })).status).toBe(400)
    expect((await addItem({ text: 'x', area: '7', newSection: 'Both' })).status).toBe(400)
    expect((await addItem({ text: 'x', newSection: '   ' })).status).toBe(400)
  })
})

describe('linking an existing observation to an item (CP-37)', () => {
  async function observation(note: string) {
    const a = await AssessmentModel.findOne({ reference: REFERENCE })
    const session =
      (await CaptureSessionModel.findOne({ assessment: a!._id })) ??
      (await CaptureSessionModel.create({ assessment: a!._id, status: 'active' }))
    return ObservationModel.create({
      assessment: a!._id,
      session: session._id,
      engineer: engineer.name,
      note,
      recordings: [],
      severity: 'low',
      location: new Types.ObjectId(),
      metadata: {
        source_type: 'observation',
        jurisdiction: 'SG',
        facility_type: TYPE,
        COPE_dimension: null,
        effective_date: new Date(),
      },
    })
  }
  const link = (id: unknown, body: object) => api.patch(`/api/observations/${id}`).send(body)

  it('links an observation to an item, shows the item answered by it, and unlinks it', async () => {
    const { checklist } = (await generate()).body
    const item = checklist.items[0]
    const o = await observation('Valve found shut.')
    const linked = await link(o._id, { checklistItem: { itemId: item.id, result: 'differs' } })
    expect(linked.status).toBe(200)
    expect(linked.body.checklistItem).toMatchObject({ itemId: item.id, result: 'differs' })
    const read = (await api.get(url)).body.checklist.items.find(
      (i: { id: string }) => i.id === item.id,
    )
    expect(read.check).toMatchObject({ result: 'differs', observation: { id: String(o._id) } })
    // The same observation may change its answer.
    const again = await link(o._id, { checklistItem: { itemId: item.id, result: 'confirmed' } })
    expect(again.status).toBe(200)
    const unlinked = await link(o._id, { checklistItem: null })
    expect(unlinked.body.checklistItem).toBeNull()
  })

  it('refuses an item another observation already checks, and an unknown or bad item', async () => {
    const { checklist } = (await generate()).body
    const item = checklist.items[0]
    const first = await observation('One.')
    const second = await observation('Two.')
    await link(first._id, { checklistItem: { itemId: item.id, result: 'confirmed' } })
    expect(
      (await link(second._id, { checklistItem: { itemId: item.id, result: 'differs' } })).status,
    ).toBe(409)
    expect(
      (await link(second._id, { checklistItem: { itemId: 'nope', result: 'differs' } })).status,
    ).toBe(400)
    expect(
      (await link(second._id, { checklistItem: { itemId: item.id, result: 'maybe' } })).status,
    ).toBe(400)
  })
})
