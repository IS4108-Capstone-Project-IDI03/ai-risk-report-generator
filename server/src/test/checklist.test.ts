import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ChecklistModel } from '../models/checklist.model'
import { KnowledgeDocumentModel, type SourceType } from '../models/knowledge-document.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { withExportPage } from '../services/export-render.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs, signedInAsRole } from './auth-test-helpers'

// The checklist's PDF (CP-32) is printed by Chromium; here its page is kept to read.
vi.mock('../services/export-render.service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  withExportPage: vi.fn(async () => Buffer.from('%PDF-1.4 checklist')),
}))

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
const REFERENCE = 'RPT-2026-0517'
const url = `/api/assessments/${REFERENCE}/checklist`

// S4 stands in as a stubbed fetch, answering /checklist/draft.
const drafts = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const reply = (model: string | null = 'claude-opus-5-5') => ({
  items: [
    {
      area: '7',
      subsection: 'Construction Narrative',
      origin: 'template',
      hazard: null,
      text: 'Walls, roof, frame and floors',
      fields: [],
      COPE_dimension: ['Construction'],
      citations: [],
      flags: [],
    },
    {
      area: 'hazards',
      subsection: null,
      origin: 'hazard',
      hazard: 'rack_storage',
      text: 'Check in-rack sprinklers are fitted for racks over 7.6 m.',
      fields: [],
      COPE_dimension: ['Occupancy', 'Protection'],
      citations: [{ ref: 'C:nfpa13:118', quote: 'rack storage over 7.6 m', quote_found: true }],
      flags: [],
    },
  ],
  areas: [{ id: '7', title: 'Construction' }],
  hazards: [
    { id: 'rack_storage', name: 'Rack storage', standards: ['NFPA 13'], in_scope: ['NFPA 13'] },
  ],
  sources: { 'C:nfpa13:118': { text: 'In-rack sprinklers…', page_start: 118 } },
  usage: [
    {
      feature: 'draft-section',
      billed_service: 'anthropic',
      model: 'claude-opus-5-5',
      duration_ms: 20000,
      input_tokens: 9000,
      output_tokens: 1500,
      cache_read_tokens: null,
      search_units: null,
      audio_seconds: null,
      usage_status: 'recorded',
    },
  ],
  provenance: {
    provider: 'anthropic',
    model,
    effort: 'medium',
    prompt_version: 'cp30-v1',
    checklist_version: 'checklist-v1-2026-10',
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: '2026-10-26T06:00:00+00:00',
  },
})

beforeEach(() => {
  drafts.mockImplementation(() => json(reply()))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/checklist/draft') ? drafts(JSON.parse(String(init!.body))) : json({}),
  )
})
afterEach(() => {
  drafts.mockReset()
  vi.unstubAllGlobals()
})

async function assessment(extra: Record<string, unknown> = {}) {
  const site = await SiteModel.create({
    code: 'SITE-0517',
    name: 'Tuas DC',
    jurisdiction: 'SG',
    facilityType: 'Distribution warehouse',
  })
  return AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'Property risk survey',
    siteVisitDate: new Date('2026-11-03'),
    engineer: engineer._id,
    ...extra,
  })
}

let files = 0
async function standard(
  title: string,
  labels: { source_type?: SourceType; facility_type?: string; jurisdiction?: string } = {},
  extra: Record<string, unknown> = {},
) {
  files += 1
  const doc = await KnowledgeDocumentModel.create({
    title,
    issuingBody: 'NFPA',
    standardNumber: '13',
    edition: '2025',
    fileName: `${files}.pdf`,
    file: {
      key: `knowledge/${files}.pdf`,
      contentType: 'application/pdf',
      size: 10,
      sha256: `sha-${files}`,
    },
    status: 'complete',
    metadata: {
      source_type: 'nfpa_standard',
      jurisdiction: 'all',
      facility_type: 'all',
      effective_date: new Date('2025-01-01'),
      ...labels,
    },
    ...extra,
  })
  return String(doc._id)
}

describe('Pre-survey checklist (CP-30)', () => {
  it('lists only the standards that apply to the site, before any checklist (AC1)', async () => {
    await assessment()
    const sprinklers = await standard('NFPA 13 Sprinkler Systems')
    const warehouses = await standard('FM 8-9 Storage', {
      source_type: 'fm_standard',
      facility_type: 'Distribution warehouse',
    })
    const local = await standard('SS 575 Hydrants', {
      source_type: 'local_standard',
      jurisdiction: 'SG',
    })
    await standard('NFPA 75 IT Equipment', { facility_type: 'Office' })
    await standard('Malaysian code', { source_type: 'local_standard', jurisdiction: 'MY' })
    await standard('Tuas DC report 2024', { source_type: 'marsh_report' })
    await standard(
      'Withdrawn edition',
      {},
      { withdrawn: { at: new Date(), by: { id: 'a', name: 'Sana' } } },
    )
    await standard('Unconfirmed edition', {}, { unconfirmed: ['edition'] })
    await standard(
      'Possible copy',
      {},
      {
        match: {
          kind: 'possible_copy',
          documentId: new Types.ObjectId(),
          newMatched: 9,
          newTotal: 10,
          storedMatched: 9,
          storedTotal: 10,
        },
      },
    )
    await standard('Still ingesting', {}, { status: 'processing' })

    const response = await api.get(url)

    expect(response.status).toBe(200)
    expect(response.body.scope).toEqual({
      facilityType: 'Distribution warehouse',
      jurisdiction: 'SG',
    })
    expect(response.body.standards.map((s: { id: string }) => s.id).sort()).toEqual(
      [sprinklers, warehouses, local].sort(),
    )
    // When each was added, so the tab can tick one added since the last checklist.
    expect(response.body.standards[0].uploadedAt).toEqual(expect.any(String))
    expect(response.body.checklist).toBeNull()
  })

  it('generates from the ticked standards only, sending no client detail (AC2)', async () => {
    await assessment()
    const sprinklers = await standard('NFPA 13 Sprinkler Systems')
    await standard('FM 8-9 Storage', { source_type: 'fm_standard' })

    const response = await api.post(url).send({ standardIds: [sprinklers] })

    expect(response.status).toBe(201)
    const sent = drafts.mock.calls[0][0]
    expect(sent).toEqual({
      facility_type: 'Distribution warehouse',
      jurisdiction: 'SG',
      standards: [{ id: sprinklers, source_type: 'nfpa_standard', standard_number: '13' }],
    })
    expect(JSON.stringify(sent)).not.toMatch(/Northgate|Tuas/)
    const { checklist } = response.body
    expect(checklist.standards).toEqual([
      expect.objectContaining({ id: sprinklers, title: 'NFPA 13 Sprinkler Systems' }),
    ])
    // Each item has an id for later stories to refer to, and its citation's quote.
    expect(checklist.items).toHaveLength(2)
    expect(checklist.items[1]).toMatchObject({
      id: expect.any(String),
      hazard: 'rack_storage',
      citations: [{ ref: 'C:nfpa13:118', quote: 'rack storage over 7.6 m', quoteFound: true }],
      status: 'active',
      prefill: null,
      check: null,
    })
    expect(checklist.hazards).toEqual([
      { id: 'rack_storage', name: 'Rack storage', standards: ['NFPA 13'], inScope: ['NFPA 13'] },
    ])
    expect(checklist.provenance).toMatchObject({
      model: 'claude-opus-5-5',
      prompt_version: 'cp30-v1',
    })
    // Its paid calls are recorded under the checklist, for the report (EV-03).
    const calls = await AiCallModel.find().lean()
    expect(calls).toEqual([
      expect.objectContaining({ feature: 'checklist', reportId: REFERENCE, inputTokens: 9000 }),
    ])
  })

  it('shows the latest checklist on reopening and keeps earlier ones (AC9)', async () => {
    await assessment()
    const first = await api.post(url).send({ standardIds: [] })
    drafts.mockImplementation(() =>
      json({ ...reply(), provenance: { ...reply().provenance, prompt_version: 'cp30-v2' } }),
    )
    const second = await api.post(url).send({ standardIds: [] })

    const response = await api.get(url)

    expect(response.body.checklist.provenance.prompt_version).toBe('cp30-v2')
    expect(await ChecklistModel.countDocuments()).toBe(2)
    // A first checklist has nothing to compare with, so nothing is new; the
    // same items generated again are not new either.
    expect(first.body.carryOver.mayReplace).toEqual([])
    expect(second.body.carryOver.mayReplace).toEqual([])
    // A knowledge admin can read it too.
    const admin = await signedInAsRole(app, 'knowledge_admin').get(url)
    expect(admin.status).toBe(200)
  })

  it('generates with no standards, with no model named (AC10)', async () => {
    await assessment()
    drafts.mockImplementation(() => json(reply(null)))

    const response = await api.post(url).send({ standardIds: [] })

    expect(response.status).toBe(201)
    expect(drafts.mock.calls[0][0].standards).toEqual([])
    expect(response.body.checklist.provenance.model).toBeNull()
  })

  it('refuses a standard that does not apply to the site', async () => {
    await assessment()
    const office = await standard('NFPA 75', { facility_type: 'Office' })

    const response = await api.post(url).send({ standardIds: [office] })

    expect(response.status).toBe(400)
    expect(drafts).not.toHaveBeenCalled()
  })

  it('refuses anyone but the assigned engineer, and an archived assessment (AC11)', async () => {
    await assessment()
    expect(
      (await signedInAsRole(app, 'risk_engineer').post(url).send({ standardIds: [] })).status,
    ).toBe(403)
    expect(
      (await signedInAsRole(app, 'knowledge_admin').post(url).send({ standardIds: [] })).status,
    ).toBe(403)
    await AssessmentModel.updateOne({ reference: REFERENCE }, { archivedAt: new Date() })
    expect((await api.post(url).send({ standardIds: [] })).status).toBe(409)
    expect(drafts).not.toHaveBeenCalled()
  })

  it('reports an S4 failure as a 503 and keeps the earlier checklist', async () => {
    await assessment()
    await api.post(url).send({ standardIds: [] })
    drafts.mockImplementation(() =>
      json({ detail: 'The language model could not be reached.' }, 502),
    )

    const response = await api.post(url).send({ standardIds: [] })

    expect(response.status).toBe(503)
    expect(response.body.error).toBe('The language model could not be reached.')
    expect(await ChecklistModel.countDocuments()).toBe(1)
  })

  it('answers 404 for an unknown assessment and 400 for a body without ids', async () => {
    expect((await api.get(url)).status).toBe(404)
    await assessment()
    expect((await api.post(url).send({})).status).toBe(400)
  })
})

describe('Verifying checklist items on site (CP-31)', () => {
  const BAY = new Types.ObjectId()
  const observations = `/api/assessments/${REFERENCE}/observations`
  const mark = (itemId: string, value: string | null, as = api) =>
    as.put(`${url}/items/${itemId}/mark`).send({ mark: value })

  // An assessment with a location and a capture session, and its first checklist.
  async function onSite() {
    const created = await assessment({
      locations: [{ _id: BAY, name: 'Bay 3', floor: 'Level 1', building: 'Block A', key: 'bay 3' }],
    })
    await CaptureSessionModel.create({ assessment: created._id, status: 'active' })
    const { body } = await api.post(url).send({ standardIds: [] })
    const [template, rack] = body.checklist.items as { id: string }[]
    return { created, template: template.id, rack: rack.id }
  }
  // Saves an observation as the checklist's Confirm or Differs does.
  const answer = (itemId: string, result: string, fields: object = {}, as = api) =>
    as.post(observations).field(
      'details',
      JSON.stringify({
        note: 'Roof is steel deck on steel purlins.',
        copeDimensions: ['Construction'],
        severity: 'low',
        locationId: String(BAY),
        checklistItem: { itemId, result },
        ...fields,
      }),
    )
  const itemCheck = async (itemId: string) =>
    (await api.get(url)).body.checklist.items.find((i: { id: string }) => i.id === itemId).check

  it('saves a Confirm as an observation linked to the item, and shows it checked (AC2)', async () => {
    const { template } = await onSite()

    const saved = await answer(template, 'confirmed')

    expect(saved.status).toBe(201)
    expect(saved.body.checklistItem).toEqual({
      itemId: template,
      result: 'confirmed',
      text: 'Walls, roof, frame and floors',
    })
    expect(saved.body.copeDimensions).toEqual(['Construction'])
    expect(await itemCheck(template)).toMatchObject({
      result: 'confirmed',
      by: 'Alex Rowe',
      observation: { id: saved.body.id, location: 'Bay 3, Level 1, Block A' },
    })
  })

  it('records a Differs on the observation, in its own words (AC3)', async () => {
    const { rack } = await onSite()

    const saved = await answer(rack, 'differs', { note: 'No in-rack sprinklers on racks at 9 m.' })

    expect(saved.status).toBe(201)
    const stored = await ObservationModel.findById(saved.body.id).lean()
    expect(stored?.checklistItem).toMatchObject({ result: 'differs' })
    expect(stored?.note).toBe('No in-rack sprinklers on racks at 9 m.')
    expect((await itemCheck(rack)).result).toBe('differs')
  })

  it('marks an item Not seen or Not applicable without an observation, and clears it (AC4)', async () => {
    const { template } = await onSite()

    const marked = await mark(template, 'not_seen')

    expect(marked.status).toBe(200)
    expect(marked.body.checklist.items[0].check).toMatchObject({
      result: 'not_seen',
      by: 'Alex Rowe',
      observation: null,
    })
    expect(await ObservationModel.countDocuments()).toBe(0)
    await mark(template, 'not_applicable')
    expect((await itemCheck(template)).result).toBe('not_applicable')
    await mark(template, null)
    expect(await itemCheck(template)).toBeNull()
  })

  it('unchecks an item when its observation is deleted, and checks it again on restore (AC5)', async () => {
    const { template } = await onSite()
    const { body } = await answer(template, 'confirmed')

    await api.delete(`/api/observations/${body.id}`)
    expect(await itemCheck(template)).toBeNull()

    await api.post(`/api/observations/${body.id}/restore`)
    expect((await itemCheck(template)).result).toBe('confirmed')
  })

  it('lets one observation check an item at a time, and an observation replace a mark', async () => {
    const { template } = await onSite()
    await mark(template, 'not_seen')
    await answer(template, 'confirmed')

    // The observation now checks it, so the mark is cleared.
    const stored = await ChecklistModel.findOne().sort({ createdAt: -1 }).lean()
    expect(stored?.items[0].check).toBeNull()
    expect((await answer(template, 'differs')).status).toBe(409)
    expect((await mark(template, 'not_applicable')).status).toBe(409)
    expect(await ObservationModel.countDocuments()).toBe(1)
  })

  it('carries answers to the same items, however the model words them this time', async () => {
    const { template, rack } = await onSite()
    await answer(template, 'confirmed')
    await mark(rack, 'not_applicable')
    // The model words the rack item differently and files it under a
    // subsection this time, citing the same passage.
    drafts.mockImplementation(() => {
      const next = reply()
      const [construction, racks] = next.items
      return json({
        ...next,
        items: [
          construction,
          { ...racks, subsection: 'Storage', text: 'Confirm in-rack sprinklers above 7.6 m.' },
        ],
      })
    })

    const regenerated = await api.post(url).send({ standardIds: [] })

    const [kept, reworded] = regenerated.body.checklist.items
    expect(regenerated.body.carryOver).toEqual({
      kept: 2,
      dropped: [],
      mayReplace: [],
      changes: { edited: 0, added: 0, removed: 0 },
    })
    expect(kept.id).not.toBe(template)
    expect(kept.check).toMatchObject({ result: 'confirmed' })
    expect(reworded.check).toMatchObject({ result: 'not_applicable' })
    // The carried item is still answered, so another Confirm is refused.
    expect((await answer(kept.id, 'confirmed')).status).toBe(409)
    expect(await ObservationModel.countDocuments()).toBe(1)
  })

  it('names an answer not kept, and the new items in its place that may replace it', async () => {
    const { rack } = await onSite()
    await answer(rack, 'differs')
    // The rack item now rests on another passage, and a new item is added in
    // Section 7, elsewhere.
    drafts.mockImplementation(() => {
      const next = reply()
      const [construction, racks] = next.items
      return json({
        ...next,
        items: [
          construction,
          {
            ...racks,
            text: 'Check sprinkler density for racks over 7.6 m.',
            citations: [{ ref: 'C:nfpa13:120', quote: 'density', quote_found: true }],
          },
          {
            ...racks,
            area: '7',
            hazard: null,
            origin: 'standard',
            text: 'Check the roof deck is non-combustible.',
          },
        ],
      })
    })

    const regenerated = await api.post(url).send({ standardIds: [] })

    const [, replacement] = regenerated.body.checklist.items
    expect(regenerated.body.carryOver).toEqual({
      kept: 0,
      dropped: ['Check in-rack sprinklers are fitted for racks over 7.6 m.'],
      mayReplace: [replacement.id],
      changes: { edited: 0, added: 0, removed: 0 },
    })
    expect(replacement.check).toBeNull()
    // Its observation stays, on its own.
    expect(await ObservationModel.countDocuments({ deleted: { $exists: false } })).toBe(1)
  })

  it('refuses an item not on the latest checklist', async () => {
    const { template } = await onSite()
    drafts.mockImplementation(() => json({ ...reply(), items: [reply().items[1]] }))
    await api.post(url).send({ standardIds: [] })

    expect((await answer(template, 'confirmed')).status).toBe(409)
    expect((await mark(template, 'not_seen')).status).toBe(404)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('refuses checks from anyone but the assigned engineer, and once archived (AC8)', async () => {
    const { created, template } = await onSite()
    const other = signedInAsRole(app, 'risk_engineer')

    expect((await answer(template, 'confirmed', {}, other)).status).toBe(403)
    expect((await mark(template, 'not_seen', other)).status).toBe(403)
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await mark(template, 'not_seen', admin)).status).toBe(403)
    await AssessmentModel.updateOne({ _id: created._id }, { archivedAt: new Date() })
    expect((await answer(template, 'confirmed')).status).toBe(409)
    expect((await mark(template, 'not_seen')).status).toBe(409)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })
})

describe('Customising the checklist (CP-32)', () => {
  const items = `${url}/items`
  const ROOF = 'Check the roof deck is non-combustible.'
  let standardId = ''
  // S4's own answers: the passages a search finds, and each passage by id.
  const passages: Record<string, object> = {}
  const searches = vi.fn<(body: Record<string, unknown>) => Response>()

  // A checklist generated from one standard: the template item, a Section 7
  // item from the standard and the rack risk's item, citing its passages.
  const generated = (
    rack = 'Check in-rack sprinklers are fitted for racks over 7.6 m.',
    roof = ROOF,
  ) => {
    const next = reply()
    const [template, racks] = next.items
    return {
      ...next,
      items: [
        template,
        {
          ...racks,
          area: '7',
          hazard: null,
          origin: 'standard',
          text: roof,
          COPE_dimension: ['Construction'],
          citations: [{ ref: 'C:nfpa13:40', quote: 'Roof decks', quote_found: true }],
        },
        { ...racks, text: rack },
      ],
      sources: {
        'C:nfpa13:118': { text: 'In-rack sprinklers…', doc_id: standardId, page_start: 118 },
        'C:nfpa13:40': { text: 'Roof decks shall be…', doc_id: standardId, page_start: 40 },
      },
    }
  }

  beforeEach(async () => {
    standardId = await standard('NFPA 13 Sprinkler Systems')
    passages['nfpa13:200'] = {
      id: 'nfpa13:200',
      documentId: standardId,
      text: 'Racks over 7.6 m shall have in-rack sprinklers. Spacing follows Table 25.',
      headings: ['Rack Storage'],
      pageStart: 200,
      pageEnd: 201,
    }
    passages['other:1'] = { ...passages['nfpa13:200'], id: 'other:1', documentId: 'other' }
    searches.mockImplementation(() => json({ results: [passages['nfpa13:200']] }))
    drafts.mockImplementation(() => json(generated()))
    vi.stubGlobal('fetch', async (to: string, init?: RequestInit) => {
      if (to.endsWith('/checklist/draft')) return drafts(JSON.parse(String(init!.body)))
      if (to.endsWith('/passages/search')) return searches(JSON.parse(String(init!.body)))
      const id = decodeURIComponent(to.split('/passages/')[1] ?? '')
      return passages[id] ? json(passages[id]) : json({ detail: 'Passage not found.' }, 404)
    })
  })

  async function withChecklist(extra: Record<string, unknown> = {}) {
    const created = await assessment(extra)
    const { body } = await api.post(url).send({ standardIds: [standardId] })
    const [template, roof, rack] = body.checklist.items as { id: string }[]
    return { created, template: template.id, roof: roof.id, rack: rack.id }
  }
  type Item = Record<string, unknown> & { id: string }
  const itemOf = (body: { checklist: { items: Item[] } }, id: string) =>
    body.checklist.items.find((i) => i.id === id)!

  it('adds, edits and removes items, and restores a removed one (AC1)', async () => {
    const { template, roof } = await withChecklist()

    const added = await api.post(items).send({
      area: '7',
      subsection: 'Construction Narrative',
      text: '  Check the cladding is non-combustible.  ',
      COPE_dimension: ['Exposure', 'Construction', 'Construction'],
    })
    expect(added.status).toBe(201)
    expect(itemOf(added.body, added.body.itemId)).toMatchObject({
      origin: 'manual',
      area: '7',
      subsection: 'Construction Narrative',
      hazard: null,
      text: 'Check the cladding is non-combustible.',
      COPE_dimension: ['Construction', 'Exposure'],
      flags: [],
      status: 'active',
      edited: null,
    })

    const edited = await api
      .patch(`${items}/${roof}`)
      .send({ text: 'Check the roof deck and insulation are non-combustible.' })
    expect(edited.status).toBe(200)
    expect(itemOf(edited.body, roof)).toMatchObject({
      text: 'Check the roof deck and insulation are non-combustible.',
      edited: { by: 'Alex Rowe' },
    })
    // How it was generated is kept for the next generation, not shown.
    const stored = await ChecklistModel.findOne().sort({ createdAt: -1 }).lean()
    expect(stored?.items[1].edited?.was.text).toBe(ROOF)

    const removed = await api.post(`${items}/${roof}/remove`)
    expect(removed.status).toBe(200)
    expect(itemOf(removed.body, roof)).toMatchObject({
      status: 'removed',
      removed: { by: 'Alex Rowe' },
    })
    expect((await api.patch(`${items}/${roof}`).send({ text: 'x' })).status).toBe(409)

    const restored = await api.post(`${items}/${roof}/restore`)
    expect(itemOf(restored.body, roof)).toMatchObject({ status: 'active', removed: null })

    // The template's subsections stay: the report has them.
    const kept = await api.post(`${items}/${template}/remove`)
    expect(kept.status).toBe(409)
    expect(kept.body.error).toMatch(/Mark it Not applicable instead/)
  })

  it('keeps an item for each priority risk, and refuses an item that does not fit', async () => {
    const { rack } = await withChecklist()

    const last = await api.post(`${items}/${rack}/remove`)
    expect(last.status).toBe(409)
    expect(last.body.error).toBe(
      'This is the last item for Rack storage. Mark it Not applicable instead.',
    )
    const own = { text: 'Check flue spaces are kept clear.', COPE_dimension: ['Occupancy'] }
    const risk = { ...own, area: 'hazards', hazard: 'rack_storage' }
    expect((await api.post(items).send(risk)).status).toBe(201)
    expect((await api.post(`${items}/${rack}/remove`)).status).toBe(200)

    expect((await api.post(items).send({ ...own, area: '99' })).status).toBe(400)
    expect((await api.post(items).send({ ...risk, hazard: 'cold' })).status).toBe(400)
    expect((await api.post(items).send({ ...own, area: '7', subsection: 'Roofs' })).status).toBe(
      400,
    )
    expect((await api.post(items).send({ ...own, area: '7', COPE_dimension: [] })).status).toBe(400)
    expect((await api.patch(`${items}/${rack}`).send({})).status).toBe(400)
  })

  it('refuses to remove an answered item, and to answer a removed one', async () => {
    const BAY = new Types.ObjectId()
    const { created, roof } = await withChecklist({
      locations: [{ _id: BAY, name: 'Bay 3', key: 'bay 3' }],
    })
    await CaptureSessionModel.create({ assessment: created._id, status: 'active' })
    const answer = () =>
      api.post(`/api/assessments/${REFERENCE}/observations`).field(
        'details',
        JSON.stringify({
          note: 'Steel deck.',
          copeDimensions: ['Construction'],
          severity: 'low',
          locationId: String(BAY),
          checklistItem: { itemId: roof, result: 'confirmed' },
        }),
      )
    const saved = await answer()
    expect(saved.status).toBe(201)

    const refused = await api.post(`${items}/${roof}/remove`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatch(/An observation answers this item/)

    await api.delete(`/api/observations/${saved.body.id}`)
    expect((await api.post(`${items}/${roof}/remove`)).status).toBe(200)
    expect((await api.put(`${items}/${roof}/mark`).send({ mark: 'not_seen' })).status).toBe(409)
    expect((await answer()).status).toBe(409)
  })

  it('changes a reference to a passage chosen from the standards in scope (AC2)', async () => {
    const { rack } = await withChecklist()

    const found = await api.get(`${url}/passages`).query({ q: 'in-rack sprinklers' })
    expect(found.status).toBe(200)
    expect(searches).toHaveBeenCalledWith({
      query: 'in-rack sprinklers',
      document_ids: [standardId],
      limit: 12,
    })
    expect(found.body.results[0]).toMatchObject({ ref: 'C:nfpa13:200', pageStart: 200 })

    // Without words chosen, the passage's first sentence is quoted.
    const changed = await api
      .patch(`${items}/${rack}`)
      .send({ citations: [{ ref: 'C:nfpa13:200', quote: '' }] })
    expect(changed.status).toBe(200)
    expect(itemOf(changed.body, rack)).toMatchObject({
      citations: [
        {
          ref: 'C:nfpa13:200',
          quote: 'Racks over 7.6 m shall have in-rack sprinklers.',
          quoteFound: true,
        },
      ],
      flags: [],
      edited: { by: 'Alex Rowe' },
    })
    // The passage is kept with the checklist, so the reference reads the same offline.
    expect(changed.body.checklist.sources['C:nfpa13:200']).toMatchObject({
      doc_id: standardId,
      page_start: 200,
      headings: ['Rack Storage'],
    })

    // Words not in the passage are kept, flagged.
    const loose = await api
      .patch(`${items}/${rack}`)
      .send({ citations: [{ ref: 'C:nfpa13:200', quote: 'Racks under 3 m need none.' }] })
    expect(itemOf(loose.body, rack).citations).toEqual([
      { ref: 'C:nfpa13:200', quote: 'Racks under 3 m need none.', quoteFound: false },
    ])

    // With no reference left, the model's item rests on no passage.
    const none = await api.patch(`${items}/${rack}`).send({ citations: [] })
    expect(itemOf(none.body, rack).flags).toEqual(['uncited'])

    // A passage outside the checklist's standards, or unknown, is refused.
    const cite = (ref: string) =>
      api.patch(`${items}/${rack}`).send({ citations: [{ ref, quote: '' }] })
    expect((await cite('C:other:1')).status).toBe(400)
    expect((await cite('C:gone:1')).status).toBe(400)
  })

  it('keeps added and edited items, and removed ones removed, when generated again (AC3)', async () => {
    const { roof, rack, template } = await withChecklist()
    await api.patch(`${items}/${rack}`).send({
      text: 'Check in-rack sprinklers on every rack over 7.6 m, aisle by aisle.',
      citations: [
        { ref: 'C:nfpa13:200', quote: 'Racks over 7.6 m shall have in-rack sprinklers.' },
      ],
    })
    await api.post(`${items}/${roof}/remove`)
    const added = await api.post(items).send({
      area: '7',
      text: 'Check the cladding is non-combustible.',
      COPE_dimension: ['Construction'],
    })
    await api.put(`${items}/${added.body.itemId}/mark`).send({ mark: 'not_seen' })
    await api.put(`${items}/${template}/mark`).send({ mark: 'not_applicable' })
    // The model words both of its items afresh, citing the same passages.
    drafts.mockImplementation(() =>
      json(
        generated(
          'Confirm in-rack sprinklers above 7.6 m.',
          'Confirm the roof deck is non-combustible.',
        ),
      ),
    )

    const again = await api.post(url).send({ standardIds: [standardId] })

    expect(again.status).toBe(201)
    const list = again.body.checklist.items as Item[]
    expect(list.map((i) => [i.text, i.status])).toEqual([
      ['Walls, roof, frame and floors', 'active'],
      ['Confirm the roof deck is non-combustible.', 'removed'],
      ['Check in-rack sprinklers on every rack over 7.6 m, aisle by aisle.', 'active'],
      ['Check the cladding is non-combustible.', 'active'],
    ])
    expect(list[2]).toMatchObject({
      citations: [expect.objectContaining({ ref: 'C:nfpa13:200' })],
      edited: { by: 'Alex Rowe' },
    })
    expect(list[3]).toMatchObject({ origin: 'manual', check: { result: 'not_seen' } })
    expect(again.body.checklist.sources['C:nfpa13:200']).toMatchObject({ page_start: 200 })
    expect(again.body.carryOver).toMatchObject({
      kept: 2,
      dropped: [],
      changes: { edited: 1, added: 1, removed: 1 },
    })
    // Matched against the model's new wording next time.
    const stored = await ChecklistModel.findOne().sort({ createdAt: -1 }).lean()
    expect(stored?.items[2].edited?.was.text).toBe('Confirm in-rack sprinklers above 7.6 m.')

    // An edited item the model no longer writes is kept as it is.
    drafts.mockImplementation(() => json({ ...generated(), items: generated().items.slice(0, 2) }))
    const third = await api.post(url).send({ standardIds: [standardId] })
    expect(third.body.checklist.items.map((i: Item) => [i.text, i.status])).toEqual([
      ['Walls, roof, frame and floors', 'active'],
      [ROOF, 'removed'],
      ['Check in-rack sprinklers on every rack over 7.6 m, aisle by aisle.', 'active'],
      ['Check the cladding is non-combustible.', 'active'],
    ])
  })

  it('downloads a PDF of every item still on it, with answers and references (AC4-5)', async () => {
    await assessment()
    expect((await api.get(`${url}/pdf`)).status).toBe(404)
    await AssessmentModel.deleteMany({})
    await SiteModel.deleteMany({})
    const { template, roof, rack } = await withChecklist()
    await api.put(`${items}/${template}/mark`).send({ mark: 'not_seen' })
    await api.patch(`${items}/${rack}`).send({ citations: [{ ref: 'C:nfpa13:200', quote: '' }] })
    await api.post(items).send({
      area: 'hazards',
      hazard: 'rack_storage',
      text: 'Check flue spaces.',
      COPE_dimension: ['Occupancy'],
    })
    await api.post(`${items}/${roof}/remove`)
    // Anyone who can open the assessment can take a copy.
    const viewer = signedInAsRole(app, 'knowledge_admin')

    const pdf = await viewer.get(`${url}/pdf`)

    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
    expect(pdf.headers['content-disposition']).toMatch(
      /RPT-2026-0517 checklist \d{4}-\d{2}-\d{2}\.pdf/,
    )
    const html = vi.mocked(withExportPage).mock.calls.at(-1)![0]
    expect(html).toContain('size: A4')
    expect(html).toContain('Tuas DC')
    expect(html).toContain('Construction Narrative')
    expect(html).toContain('Not seen</b> Alex Rowe')
    expect(html).toContain(
      'NFPA 13 Sprinkler Systems, 2025 edition, pp. 200–201: <span class="quote">“Racks over 7.6 m shall have in-rack sprinklers.”</span>',
    )
    expect(html).toContain('Check flue spaces.<span class="tag">Added</span>')
    expect(html).not.toContain(ROOF)
    // Nothing in it is fetched: it reads the same offline.
    expect(html).not.toMatch(/\b(src|href)=|url\(|@import/i)
  })

  it('refuses changes from anyone but the assigned engineer, and once archived (AC6)', async () => {
    const { created, roof } = await withChecklist()
    const own = { area: '7', text: 'Check the cladding.', COPE_dimension: ['Construction'] }
    for (const as of [
      signedInAsRole(app, 'risk_engineer'),
      signedInAsRole(app, 'knowledge_admin'),
    ]) {
      expect((await as.post(items).send(own)).status).toBe(403)
      expect((await as.patch(`${items}/${roof}`).send({ text: 'x' })).status).toBe(403)
      expect((await as.post(`${items}/${roof}/remove`)).status).toBe(403)
      expect((await as.post(`${items}/${roof}/restore`)).status).toBe(403)
    }
    await AssessmentModel.updateOne({ _id: created._id }, { archivedAt: new Date() })
    expect((await api.post(items).send(own)).status).toBe(409)
    expect((await api.patch(`${items}/${roof}`).send({ text: 'x' })).status).toBe(409)
    expect((await api.post(`${items}/${roof}/remove`)).status).toBe(409)
    const stored = await ChecklistModel.findOne().sort({ createdAt: -1 }).lean()
    expect(stored?.items.map((i) => [i.text, i.status])).toEqual([
      ['Walls, roof, frame and floors', 'active'],
      [ROOF, 'active'],
      ['Check in-rack sprinklers are fitted for racks over 7.6 m.', 'active'],
    ])
  })
})
