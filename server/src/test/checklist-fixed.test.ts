import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel } from '../models/site.model'
import { seedFixedItems } from '../services/checklist-fixed.service'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// CP-37: fixed checklist items per site type, past-report questions and the no-data note.
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

const add = (text: string, facilityType = TYPE, extra = {}) =>
  admin.post(SETTINGS).send({ facilityType, text, ...extra })
const generate = () => api.post(url).send({ standardIds: [] })

describe('fixed checklist items, admin side (CP-37 AC4)', () => {
  it('only a knowledge admin can read or change them', async () => {
    expect((await api.get(SETTINGS)).status).toBe(403)
    expect((await api.post(SETTINGS).send({ facilityType: TYPE, text: 'x' })).status).toBe(403)
    expect((await admin.get(SETTINGS)).status).toBe(200)
  })

  it('lists the site types and starts with placeholder items for them', async () => {
    await seedFixedItems()
    await seedFixedItems()
    const res = await admin.get(SETTINGS)
    expect(res.body.facilityTypes).toContain(TYPE)
    expect(res.body.items.some((i: { facilityType: string }) => i.facilityType === TYPE)).toBe(true)
  })

  it('adds, edits, removes and restores an item', async () => {
    const created = await add('Is the sprinkler valve sealed open?', TYPE, { area: '8' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      facilityType: TYPE,
      text: 'Is the sprinkler valve sealed open?',
      area: '8',
      removed: false,
    })
    const id = created.body.id
    const edited = await admin.patch(`${SETTINGS}/${id}`).send({ text: 'Valve sealed open?' })
    expect(edited.body.text).toBe('Valve sealed open?')
    const removed = await admin.delete(`${SETTINGS}/${id}`)
    expect(removed.body.removed).toBe(true)
    const listed = (await admin.get(SETTINGS)).body.items
    expect(listed.find((i: { id: string }) => i.id === id).removed).toBe(true)
    const restored = await admin.post(`${SETTINGS}/${id}/restore`)
    expect(restored.body.removed).toBe(false)
  })

  it('refuses an unknown site type, empty or long text, and an unknown id', async () => {
    expect((await add('x', 'Moon base')).status).toBe(400)
    expect((await add('   ')).status).toBe(400)
    expect((await add('x'.repeat(501))).status).toBe(400)
    const missing = new Types.ObjectId()
    expect((await admin.patch(`${SETTINGS}/${missing}`).send({ text: 'x' })).status).toBe(404)
    expect((await admin.delete(`${SETTINGS}/not-an-id`)).status).toBe(404)
  })
})

describe('the generated checklist (CP-37 AC1, AC3, AC5)', () => {
  it('always has the fixed items of the site type, marked fixed, and not those of other types', async () => {
    await add('Is the roof access locked?')
    await add('Cold room alarm tested?', 'Cold store')
    const { checklist } = (await generate()).body
    const texts = checklist.items.map((i: { text: string }) => i.text)
    expect(texts).toContain('Is the roof access locked?')
    expect(texts).not.toContain('Cold room alarm tested?')
    const fixed = checklist.items.filter((i: { fixed?: boolean }) => i.fixed)
    expect(fixed.length).toBeGreaterThan(0)
    expect(fixed.every((i: { origin: string }) => i.origin === 'fixed')).toBe(true)
    expect(checklist.areas.map((a: { id: string }) => a.id)).toContain('fixed')
    expect(
      checklist.items.find((i: { text: string }) => i.text === 'Walls, roof, frame and floors')
        .fixed,
    ).toBeFalsy()
  })

  it('a removed fixed item is not added', async () => {
    const created = await add('Is the roof access locked?')
    await admin.delete(`${SETTINGS}/${created.body.id}`)
    const { checklist } = (await generate()).body
    expect(checklist.items.map((i: { text: string }) => i.text)).not.toContain(
      'Is the roof access locked?',
    )
  })

  it('shows each past-report question with its source report', async () => {
    const { checklist } = (await generate()).body
    const past = checklist.items.find((i: { origin: string }) => i.origin === 'past_report')
    expect(past.sourceReports).toEqual([{ title: 'Tuas DC 2024', docId: 'rep1' }])
    expect(past.flags).not.toContain('uncited')
    expect(checklist.notes).toEqual([])
  })

  it('with no past-report data says so and still gives the fixed items', async () => {
    await add('Is the roof access locked?')
    drafts.mockImplementation(() => json(reply([standardItem], true)))
    const { checklist } = (await generate()).body
    expect(checklist.notes).toHaveLength(1)
    expect(checklist.notes[0]).toMatch(/past Marsh reports/)
    expect(checklist.items.some((i: { fixed?: boolean }) => i.fixed)).toBe(true)
    // It survives a reload.
    expect((await api.get(url)).body.checklist.notes).toEqual(checklist.notes)
  })

  it('keeps one answer on a fixed item when generated again, and a fixed item once', async () => {
    await add('Is the roof access locked?')
    const first = (await generate()).body.checklist
    const item = first.items.find((i: { text: string }) => i.text === 'Is the roof access locked?')
    await api.put(`${url}/items/${item.id}/mark`).send({ mark: 'not_seen' })
    const again = (await generate()).body.checklist
    const same = again.items.filter(
      (i: { text: string }) => i.text === 'Is the roof access locked?',
    )
    expect(same).toHaveLength(1)
    expect(same[0].check?.result).toBe('not_seen')
  })
})
