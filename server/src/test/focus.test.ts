// The Focus list (AS-06 AC 12), as the work list's rows carry it (priority and
// rank): overdue first, then Fix now, then least time to spare, and only the
// caller's own open assessments, counted in the team's time zone.
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { AssistantBriefModel } from '../models/assistant-brief.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { dayOf } from '../services/assistant/dates'
import { priorityFor, rankedFocus } from '../services/assistant/focus.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const DAY = 86_400_000
// Today where the team works, as MarshBot counts it.
const todayDay = dayOf(new Date())
const today = Date.parse(todayDay)
// A stored date `offset` days from today (dates are kept as UTC midnight).
const day = (offset: number) => new Date(today + offset * DAY)

async function engineer(n: number) {
  return UserModel.create({
    staffId: `T-${n}`,
    name: `Engineer ${n}`,
    email: `e${n}@example.com`,
    role: 'risk_engineer',
  })
}

let seq = 0
// One assessment at its own site of the client; extra fields (e.g. stage) are written as stored.
async function visit(
  owner: Types.ObjectId,
  client: Types.ObjectId,
  fields: Record<string, unknown>,
) {
  seq++
  const site = await SiteModel.create({
    code: `SITE-${seq}`,
    name: `Site ${seq}`,
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
    client,
  })
  const reference = `RPT-2026-${String(seq).padStart(4, '0')}`
  await AssessmentModel.collection.insertOne({
    reference,
    site: site._id,
    surveyType: 'First survey',
    engineer: owner,
    locations: [],
    appendixPhotos: [],
    ...fields,
  })
  return reference
}

// A brief holding one open Fix now item, stored raw so the test doesn't depend on the brief's other fields.
const fixNowBrief = (reference: string) =>
  AssistantBriefModel.collection.insertOne({
    reference,
    stage: 'capture',
    items: [
      {
        id: 'a',
        weight: 'gap',
        title: 'Fire Protection',
        detail: '2 of 9 answered',
        resolvedAt: null,
      },
      {
        id: 'b',
        weight: 'fix_now',
        title: 'Loading Bay 2',
        detail: "1:48 · Couldn't transcribe",
        resolvedAt: null,
      },
    ],
  })

type Row = { reference: string; stage: string; priority: { rank: number; text: string } | null }
// The work list's rows with a priority, in Focus order, as the browser builds Focus.
const focusOf = (rows: Row[]) =>
  rows.filter((r) => r.priority).sort((a, b) => a.priority!.rank - b.priority!.rank)

describe('Focus on the work list', () => {
  it("ranks the caller's own open assessments: overdue, then Fix now, then least time to spare", async () => {
    const alex = await engineer(1)
    const other = await engineer(2)
    const client = await ClientModel.create({ name: 'Harbourline', key: 'harbourline' })
    const c = client._id
    const relaxed = await visit(alex._id, c, { stage: 'capture', reportDueDate: day(30) })
    const tight = await visit(alex._id, c, { stage: 'capture', reportDueDate: day(4) }) // 4 − 3 days of work = 1 spare
    const tighter = await visit(alex._id, c, { stage: 'review', reportDueDate: day(1) }) // 1 − 2 = none
    const broken = await visit(alex._id, c, { stage: 'capture', reportDueDate: day(20) })
    await fixNowBrief(broken)
    const late = await visit(alex._id, c, { stage: 'capture', reportDueDate: day(-2) })
    const later = await visit(alex._id, c, { reportDueDate: day(-5) }) // no stage yet: counts as setup
    await visit(alex._id, c, { stage: 'capture', reportDueDate: day(-9), archivedAt: new Date() })
    await visit(alex._id, c, { stage: 'exported', reportDueDate: day(-9) })
    await visit(other._id, c, { stage: 'capture', reportDueDate: day(-9) })

    const { body } = await signedInAs(app, alex).get('/api/assessments').expect(200)
    const focus = focusOf(body as Row[])

    expect(focus.map((r) => r.reference)).toEqual([later, late, broken, tighter, tight])
    expect(focus.map((r) => r.priority!.rank)).toEqual([1, 2, 3, 4, 5])
    expect(focus[0]).toMatchObject({
      reference: later,
      reportDueDate: day(-5).toISOString().slice(0, 10),
      stage: 'setup',
      priority: { reason: 'overdue', text: 'Report 5 days overdue, nothing drafted yet.', rank: 1 },
    })
    expect(focus.map((r) => r.priority!.text).slice(2)).toEqual([
      "Loading Bay 2 · 1:48 · Couldn't transcribe",
      'No time to spare before the report is due.',
      '1 day to spare before the report is due.',
    ])
    expect(focus.map((r) => r.reference)).not.toContain(relaxed)
  })

  it("counts the day in the team's time zone: just after midnight in Singapore, yesterday's report is overdue", async () => {
    const alex = await engineer(1)
    const client = await ClientModel.create({ name: 'Northgate', key: 'northgate' })
    const due = await visit(alex._id, client._id, {
      stage: 'capture',
      reportDueDate: new Date('2026-11-14'),
    })
    // 00:30 on 15 Nov in Singapore, still 14 Nov in UTC.
    const [first] = await rankedFocus(String(alex._id), new Date('2026-11-14T16:30:00Z'))
    expect(first).toMatchObject({ reference: due, priority: { reason: 'overdue', rank: 1 } })
  })

  it("marks the work list's rows with their priority", async () => {
    const alex = await engineer(1)
    const client = await ClientModel.create({ name: 'Northgate', key: 'northgate' })
    const late = await visit(alex._id, client._id, { stage: 'generate', reportDueDate: day(-1) })
    const relaxed = await visit(alex._id, client._id, { reportDueDate: day(30) })
    const api = signedInAs(app, alex)

    const rows = (await api.get('/api/assessments').expect(200)).body
    const row = (ref: string) => rows.find((r: { reference: string }) => r.reference === ref)
    expect(row(late)).toMatchObject({ stage: 'generate', priority: { reason: 'overdue', rank: 1 } })
    expect(row(relaxed)).toMatchObject({ stage: 'setup', priority: null })
  })
})

describe('priorityFor', () => {
  it('counts the time to spare before the survey while the visit is being prepared', () => {
    expect(
      priorityFor(
        { stage: 'setup', siteVisitDate: day(2), reportDueDate: day(30), drafted: false },
        todayDay,
      ),
    ).toEqual({
      reason: 'short_on_time',
      text: '1 day to spare before the survey.',
      urgency: 1.5,
    })
  })
})
