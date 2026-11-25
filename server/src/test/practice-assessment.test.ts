// F-12 test seam 1: a user's practice assessment (ADR 0003) is made once, reset and removed
// without deleting anything, and opens on every tab through the real routes, with no AI call.
// Calls practice.service.ts directly and the routes through supertest on an in-memory Mongo.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { UserSettingsModel } from '../models/user-settings.model'
import type { SessionUser } from '../services/auth.service'
import { ensurePractice, removePractice } from '../services/practice/practice.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const actor = {
  _id: new Types.ObjectId(),
  staffId: 'MRE-0101',
  name: 'Priya Nair',
  email: 'priya@example.com',
  role: 'risk_engineer' as const,
  active: true,
}
// Generation's step 1 parts, in its order (generation/types.ts STEP_ONE_PARTS).
const STEP_ONE = ['3', '6', '7', '8', '9', '10', '11', '12']
const user: SessionUser = { id: String(actor._id), role: actor.role, name: actor.name }
const api = signedInAs(app, actor as never)

// rag-service's template list (GET /sections) is not AI; every other outside call is
// recorded and refused, so a test can prove creation sent nothing to an AI service.
const ALL = ['Construction', 'Occupancy', 'Protection', 'Exposure']
const TEMPLATE = [
  ['4', ALL],
  ['5', ALL],
  ['6', ALL],
  ['7', ['Construction']],
  ['8', ['Occupancy']],
  ['9', ['Protection']],
  ['10', ['Exposure']],
  ['11', ['Protection']],
  ['12', ['Exposure', 'Occupancy']],
].map(([id, cope]) => ({ id, title: `Title ${id}`, cope_dimensions: cope, min_observations: 1 }))
let outside: string[] = []

beforeEach(async () => {
  outside = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/sections') && !init?.body)
      return new Response(JSON.stringify({ sections: TEMPLATE }), {
        headers: { 'Content-Type': 'application/json' },
      })
    outside.push(String(url))
    throw new Error(`No outside call expected: ${url}`)
  })
  await UserModel.create(actor)
})
afterEach(() => vi.unstubAllGlobals())

describe('making the practice assessment', () => {
  it('makes exactly one, and a second call returns the same reference', async () => {
    const first = await ensurePractice(user)
    expect(first).toMatch(/^PRACTICE-\d{4}$/)
    expect(await ensurePractice(user)).toBe(first)
    expect(await AssessmentModel.countDocuments({ engineer: actor._id })).toBe(1)
    const made = await AssessmentModel.findOne({ reference: first }).lean()
    expect(made).toMatchObject({ practice: 'live', surveyType: 'First survey', stage: 'generate' })
    expect(await ClientModel.countDocuments({ practice: true })).toBe(1)
    expect(await SiteModel.countDocuments({ practice: true })).toBe(1)
    expect(outside).toEqual([])
  })

  it('makes one when two calls arrive at once (two tabs)', async () => {
    // A call that finds the other's still being made answers null (no practice yet).
    const answers = await Promise.all([ensurePractice(user), ensurePractice(user)])
    const live = await AssessmentModel.findOne({ practice: 'live' }).lean()
    expect(answers.filter(Boolean)).toContain(live!.reference)
    expect(new Set(answers.filter(Boolean)).size).toBe(1)
    expect(await AssessmentModel.countDocuments({ practice: 'live' })).toBe(1)
    expect(await ClientModel.countDocuments({ practice: true })).toBe(1)
  })

  it('hands out none still being made, until it is a minute old and counts as abandoned', async () => {
    const making = (createdAt: Date) =>
      AssessmentModel.collection.insertOne({
        reference: 'PRACTICE-0900',
        site: new Types.ObjectId(),
        surveyType: 'First survey',
        engineer: actor._id,
        practice: 'making',
        locations: [],
        createdAt,
      })
    const { insertedId } = await making(new Date())
    expect(await ensurePractice(user)).toBeNull()
    expect(JSON.stringify((await api.get('/api/assessments')).body)).not.toContain('PRACTICE-0900')
    expect((await api.get('/api/assessments/PRACTICE-0900/locations')).status).toBe(404)

    await AssessmentModel.collection.updateOne(
      { _id: insertedId },
      { $set: { createdAt: new Date(Date.now() - 2 * 60_000) } },
    )
    const made = await ensurePractice(user)
    expect(made).toMatch(/^PRACTICE-\d{4}$/)
    expect(made).not.toBe('PRACTICE-0900')
  })

  it('a Remove at the same moment as first sign-in leaves no live one', async () => {
    await Promise.all([ensurePractice(user), removePractice(user)])
    expect(await AssessmentModel.countDocuments({ practice: 'live' })).toBe(0)
    expect(await ensurePractice(user)).toBeNull()
  })
})

describe('resetting and removing it (never deleting)', () => {
  it('Reset hides the old one, keeps its records, and makes a fresh one', async () => {
    const old = await ensurePractice(user)
    const logged = await ReviewAuditModel.countDocuments()
    const res = await api.post('/api/walkthroughs/practice')
    expect(res.status).toBe(201)
    expect(res.body.reference).toMatch(/^PRACTICE-\d{4}$/)
    expect(res.body.reference).not.toBe(old)
    expect(await AssessmentModel.findOne({ reference: old }).lean()).toMatchObject({
      practice: 'hidden',
    })
    expect(await ClientModel.countDocuments({ practice: true })).toBe(2)
    expect(await SiteModel.countDocuments({ practice: true })).toBe(2)
    expect(await ReviewAuditModel.countDocuments()).toBeGreaterThanOrEqual(logged * 2)
    expect(await ensurePractice(user)).toBe(res.body.reference)
  })

  it('Remove hides it for good, and Set it up again brings one back', async () => {
    const old = await ensurePractice(user)
    expect((await api.delete('/api/walkthroughs/practice')).status).toBe(204)
    expect(await AssessmentModel.findOne({ reference: old }).lean()).toMatchObject({
      practice: 'hidden',
    })
    expect(await ensurePractice(user)).toBeNull()
    expect(await AssessmentModel.countDocuments({ practice: { $exists: true } })).toBe(1)

    const again = await api.post('/api/walkthroughs/practice')
    expect(again.status).toBe(201)
    expect(await ensurePractice(user)).toBe(again.body.reference)
  })
})

describe('a user settings record whose walkthroughs is null', () => {
  it('still lets Reset, Remove and Set it up again work', async () => {
    await UserSettingsModel.collection.insertOne({
      user: user.id,
      walkthroughs: null,
      metadata: { source_type: 'settings', effective_date: new Date() },
    })
    expect((await api.post('/api/walkthroughs/practice')).status).toBe(201)
    expect((await api.delete('/api/walkthroughs/practice')).status).toBe(204)
    expect(await ensurePractice(user)).toBeNull()
    expect((await api.post('/api/walkthroughs/practice')).status).toBe(201)
    expect(await ensurePractice(user)).not.toBeNull()
  })
})

describe('opening it on every tab', () => {
  it('serves every tab from Overview to Export to its owner, with no AI call', async () => {
    const ref = (await ensurePractice(user))!

    const locations = await api.get(`/api/assessments/${ref}/locations`)
    expect(locations.status).toBe(200)
    expect(locations.body).toHaveLength(3)
    expect(locations.body).toContainEqual(
      expect.objectContaining({ building: 'Block A', floor: 'Level 1', name: 'Loading bay' }),
    )

    const observations = await api.get(`/api/assessments/${ref}/observations`)
    expect(observations.body).toHaveLength(8)
    const amber = observations.body.filter((o: { toCheck: boolean }) => o.toCheck)
    expect(amber).toHaveLength(1)
    expect(amber[0].suggestion).toMatchObject({ status: 'done', category: { notSure: true } })

    const checklist = await api.get(`/api/assessments/${ref}/checklist`)
    const items = checklist.body.checklist.items
    expect(items.length).toBeGreaterThan(0)
    // One item is left unanswered on purpose: the Checklist walkthrough shows the answers on it.
    const marked = new Set(
      items.filter((i: { check: unknown }) => i.check !== null).map((i: { id: string }) => i.id),
    )
    const observed = new Set(
      observations.body.map((o: { checklistItem?: { item: string } }) => o.checklistItem?.item),
    )
    const open = items.filter((i: { id: string }) => !marked.has(i.id) && !observed.has(i.id))
    expect(open.map((i: { text: string }) => i.text)).toEqual([
      'Fire alarm panel: faults shown and last service date',
    ])
    // And one note carries a question for the client, so "To ask the client" has a row.
    const toAsk = await api.get(`/api/assessments/${ref}/to-ask`)
    expect(toAsk.body.items).toHaveLength(1)

    const walks = await api.get(`/api/assessments/${ref}/site-walks`)
    expect(walks.body).toHaveLength(1)
    expect(walks.body[0]).toMatchObject({ status: 'ready', name: 'Sample walk' })

    // Generation: step 1 drafted (3, 6-12), step 2 waits on the engineer, step 3 not started.
    const generation = await api.get(`/api/assessments/${ref}/generation`)
    expect(generation.status).toBe(200)
    expect(generation.body.checkpoint).toEqual({ kind: 'input_needed' })
    type Part = { id: string; drafted: boolean; outOfDate: unknown }
    const parts: Part[] = generation.body.parts
    expect(parts.filter((p) => p.drafted).map((p) => p.id)).toEqual(STEP_ONE)
    expect(parts.every((p) => p.outOfDate === null)).toBe(true)

    const review = await api.get(`/api/assessments/${ref}/review`)
    expect(review.status).toBe(200)
    type Statement = { supported: boolean; citations: string[]; review: { state: string } }
    type Section = {
      id: string
      review: { state: string; changesSinceDraft: number }
      draft: { subsections: { statements: Statement[] }[] } | null
    }
    const sections: Section[] = review.body.sections
    const findings = (id: string) =>
      sections.find((s) => s.id === id)!.draft!.subsections.flatMap((x) => x.statements)
    expect(sections.filter((s) => s.draft).map((s) => s.id)).toEqual(STEP_ONE.slice(1))
    expect(sections.every((s) => s.review.changesSinceDraft === 0)).toBe(true)
    for (const id of ['6', '8', '10', '11', '12'])
      expect(sections.find((s) => s.id === id)!.review.state).toBe('reviewed')
    expect(findings('7').every((f) => f.review.state === 'pending')).toBe(true)
    expect(findings('7')[0].citations[0]).toMatch(/^O:/)
    expect(findings('9').map((f) => [f.supported, f.review.state])).toEqual([
      [true, 'accepted'],
      [false, 'pending'],
    ])

    const ofis = await api.get(`/api/assessments/${ref}/ofis`)
    expect(ofis.body.suggestions).toHaveLength(3)
    expect(ofis.body.accepted).toHaveLength(0)

    const scores = await api.get(`/api/assessments/${ref}/risk-quality`)
    expect(scores.body.proposal.categories).toHaveLength(7)
    expect(scores.body.categories.every((c: { current: null }) => c.current === null)).toBe(true)
    const losses = await api.get(`/api/assessments/${ref}/loss-estimates`)
    expect(losses.body.proposal.levels).toHaveLength(3)

    const exporting = await api.get(`/api/assessments/${ref}/export`)
    expect(exporting.status).toBe(200)
    // "Left to finish": step 3 (Sections 2, 4, 5), Section 3's OFI, and the two Review steps.
    type Blocker = { sectionId: string; reason: string }
    expect(
      exporting.body.blockers.map((x: Blocker) => [x.sectionId, x.reason.split('.')[0]]),
    ).toEqual([
      ['2', 'It is not drafted yet'],
      ['3', 'No Opportunity for Improvement is accepted yet'],
      ['4', 'Its figures are not all entered'],
      ['4', 'It is not written yet'],
      ['5', 'Its figures are not all entered'],
      ['5', 'It is not written yet'],
      ['7', '4 findings are waiting for your decision'],
      ['9', '1 finding is waiting for your decision'],
      ['9', '1 finding is unsupported by evidence'],
    ])

    expect(outside).toEqual([])
  })

  // Not a try-it: it must work with AI down. Opening asks the wording AI to reword new turns;
  // here every AI call is refused, so the rule words stand and nothing fails.
  it('builds the Overview conversation in fixed phrases on first open when the wording AI is down', async () => {
    const ref = (await ensurePractice(user))!
    const opened = await api.get(`/api/assessments/${ref}/assistant`)
    expect(opened.status).toBe(200)
    await vi.waitFor(async () => {
      expect((await api.get(`/api/assessments/${ref}/assistant`)).body.thinking).toBe(false)
    })
    const read = await api.get(`/api/assessments/${ref}/assistant`)
    expect(read.status).toBe(200)
    const turns = read.body.session.turns
    type Turn = { who: string; topic: string; says: { text: string }[]; program: unknown }
    // The rule words, never reworded: the greeting, then To Do for the ready Sample walk.
    expect(turns.map((t: Turn) => [t.who, t.topic, t.program])).toEqual([
      ['bot', 'greeting', null],
      ['bot', 'todo', null],
    ])
    expect(turns[0].says[0].text).toContain('Section 3 and Sections 6 to 12 are drafted')
    // The Overview walkthrough's hands-on step presses this reply, so it must be here on first open.
    expect(read.body.replies.map((r: { label: string }) => r.label)).toEqual(['Skip for now'])
    // Skip for now leads to the next step, which in Generate with input needed offers no
    // "What else?" (board 18, topics-drafting.ts ACTS): only its Open Review button.
    const skipped = await api
      .post(`/api/assessments/${ref}/assistant/replies`)
      .send({ replyId: 'skip', lastTurnId: turns.at(-1).id })
    expect(skipped.status).toBe(200)
    await vi.waitFor(async () => {
      expect((await api.get(`/api/assessments/${ref}/assistant`)).body.thinking).toBe(false)
    })
    const after = await api.get(`/api/assessments/${ref}/assistant`)
    expect(after.body.session.turns.map((t: Turn) => t.topic).slice(2)).toEqual([
      'reply',
      'answer',
      'next-step',
    ])
    expect(after.body.replies).toEqual([])
  })
})
