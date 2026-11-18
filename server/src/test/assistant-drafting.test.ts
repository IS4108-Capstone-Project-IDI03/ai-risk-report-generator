// MarshBot and background drafting (GN-13 test seam 1's stage test, AC 12): the stage moves to
// Review only when all 11 parts are drafted, and MarshBot's next step in the Generate stage names
// the same checkpoint as Generation. Seeded as generation.test.ts seeds it; S4 is a stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { AssistantBriefModel } from '../models/assistant-brief.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { settleBackground } from '../services/assistant/background'
import { refreshBrief } from '../services/assistant/recheck.service'
import type { AssistantThread, Card } from '../services/assistant/types'
import { drainInlineJobs, setInlineAttempts } from '../services/job-queue.service'
import { signedInAs } from './auth-test-helpers'
import {
  assessment,
  doTasks,
  everyCategory,
  fakeS4,
  observation,
  people,
  REF,
} from './generation-fixtures'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const generation = `/api/assessments/${REF}/generation`
const assistant = `/api/assessments/${REF}/assistant`
type Api = ReturnType<typeof signedInAs>

beforeEach(() => {
  fakeS4()
})
afterEach(async () => {
  await drainInlineJobs()
  await settleBackground()
  setInlineAttempts(1)
  vi.unstubAllGlobals()
})

async function setup() {
  const { engineer } = await people()
  const ids = await assessment(engineer._id)
  return { api: signedInAs(app, engineer), ids }
}

async function draftNow(api: Api) {
  await api.post(`${generation}/run`).expect(202)
  await drainInlineJobs()
}

const stageNow = async () => (await AssessmentModel.findOne({ reference: REF }).lean())!.stage

// MarshBot after a re-check: the stage, the greeting, its next step (words and button) and
// the checkpoint it read, beside Generation's.
async function marshBot(api: Api) {
  await refreshBrief(REF)
  await api.get(assistant).expect(200)
  await settleBackground()
  const t = (await api.get(assistant).expect(200)).body as AssistantThread
  const step = t.session.turns.filter((x) => x.topic === 'next-step').at(-1)
  const card = step?.cards[0] as Extract<Card, { type: 'rows' }> | undefined
  const brief = await AssistantBriefModel.findOne({ reference: REF }).lean()
  return {
    stage: t.stage,
    greeting: t.session.turns[0].says[0].text,
    says: step?.says.map((s) => s.text) ?? null,
    lead: step?.says.find((s) => s.tone === 'lead')?.text ?? null,
    cta: card?.cta ?? null,
    replies: t.replies.map((r) => r.id),
    read: (brief!.facts as { drafting?: { checkpoint: unknown } }).drafting?.checkpoint,
    generation: (await api.get(generation).expect(200)).body.checkpoint,
  }
}

describe('the stage (GN-13 rule 11)', () => {
  it('moves to Review only once all 11 parts are drafted', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)
    await refreshBrief(REF)
    expect(await stageNow()).toBe('generate')

    await doTasks(ids.id)
    await draftNow(api)
    await refreshBrief(REF)
    expect(await stageNow()).toBe('review')
  })

  it('stays in Generate after a first review decision', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)
    const draft = await ReportSectionModel.findOne({ assessment: ids.id, sectionId: '7' })
    await ReviewAuditModel.create({
      assessment: ids.id,
      sectionId: '7',
      draft: draft!._id,
      finding: '0.0',
      sequence: 0,
      action: 'accept',
      by: { id: 'u', name: 'Alex Rowe' },
      at: new Date(),
      metadata: {
        source_type: 'review_decision',
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: 'Construction',
        effective_date: new Date(),
      },
    })

    await refreshBrief(REF)

    expect(await stageNow()).toBe('generate')
  })

  it('keeps an assessment already in Review there', async () => {
    const { ids } = await setup()
    await everyCategory(ids)
    await AssessmentModel.updateOne({ _id: ids.id }, { $set: { stage: 'review' } })

    await refreshBrief(REF)

    expect(await stageNow()).toBe('review')
  })
})

describe("MarshBot's next step follows Generation's checkpoint (AC 12)", () => {
  it('names the 2 things the engineer owes, with Open Review (board 18)', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)

    const m = await marshBot(api)

    expect(m.generation).toEqual({ kind: 'input_needed' })
    expect(m.read).toEqual(m.generation)
    expect(m.stage).toBe('generate')
    expect(m.greeting).toMatch(
      /^Good \w+, Alex! Section 3 and Sections 6 to 12 are drafted and ready for you in Review\.$/,
    )
    expect(m.says).toEqual([
      'Before I can draft the last 3 sections, I need 2 things from you.',
      '**Sections 4 and 5** need their figures, and **Section 2** needs at least 1 accepted OFI in Section 3. Once those are in, draft them from Generation.',
    ])
    expect(m.cta).toEqual({ label: 'Open Review', link: { tab: 'review' } })
    // One reply, Open Review: no "What else?" while the engineer must act.
    expect(m.replies).toEqual([])
  })

  it('names only the tasks still open', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)
    await ReportOfiModel.updateOne({ assessment: ids.id }, { $set: { state: 'accepted' } })

    const m = await marshBot(api)

    expect(m.says).toEqual([
      'Before I can draft the last 3 sections, I need 1 thing from you.',
      "**Sections 4 and 5** need their figures. Once that's in, draft them from Generation.",
    ])
  })

  it('points out the sections with no observation, with Open Observations', async () => {
    const { api, ids } = await setup()
    await observation(ids, ['Construction'])
    // Figures entered first are drafting work, so the assessment is in Generate.
    await doTasks(ids.id)

    const m = await marshBot(api)

    expect(m.generation).toEqual({
      kind: 'needs_observations',
      sections: ['8', '9', '10', '11', '12'],
    })
    expect(m.read).toEqual(m.generation)
    expect(m.lead).toBe('Before I can draft, Sections 8 to 12 need at least 1 observation each.')
    expect(m.cta).toEqual({ label: 'Open Observations', link: { tab: 'observations' } })
  })

  it('waits for recordings still transcribing, with nothing to press', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await observation(ids, ['Protection'], { transcribing: true })
    await doTasks(ids.id)

    const m = await marshBot(api)

    expect(m.generation.kind).toBe('transcribing')
    expect(m.says).toEqual([
      '1 recording is still transcribing. You can draft when it finishes, so its observations are included.',
    ])
    expect(m.cta).toBeNull()
  })

  it('is ready to draft from observations, with Open Generation', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await doTasks(ids.id)

    const m = await marshBot(api)

    expect(m.generation).toMatchObject({ kind: 'ready', step: 1 })
    expect(m.lead).toBe('The report is ready to draft from your observations.')
    expect(m.says![1]).toBe(
      `Drafting ${m.generation.parts.length} sections runs in the background and takes a few minutes. Start it from Generation.`,
    )
    expect(m.cta).toEqual({ label: 'Open Generation', link: { tab: 'generate' } })
  })

  it('says it is drafting in the background, with nothing to press', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)
    await doTasks(ids.id)
    // S4 holds every draft until released, so the run is caught mid-way; MarshBot's wording isn't held.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    fakeS4((call) => (call.route.startsWith('/assistant') ? undefined : held.then(() => undefined)))
    await api.post(`${generation}/run`).expect(202)

    const m = await marshBot(api)
    release()

    expect(m.generation).toMatchObject({ kind: 'drafting', step: 3 })
    expect(m.says).toEqual([
      `I'm drafting ${m.generation.parts.length} sections in the background. It takes a few minutes, and the bell will tell you when it's done.`,
    ])
    expect(m.cta).toBeNull()
  })

  it('names a section that was not drafted, with Open Generation for Try again', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    setInlineAttempts(3)
    fakeS4((call) =>
      call.body.section_id === '9'
        ? new Response(JSON.stringify({ detail: 'The model is overloaded.' }), { status: 500 })
        : undefined,
    )
    await draftNow(api)

    const m = await marshBot(api)

    expect(m.generation).toEqual({ kind: 'failed', failed: ['9'], parts: ['9'] })
    expect(m.lead).toBe('Section 9 was not drafted.')
    expect(m.cta).toEqual({ label: 'Open Generation', link: { tab: 'generate' } })
  })

  it("is ready to draft from the engineer's input, out-of-date sections first", async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)
    await doTasks(ids.id)
    await ReportSectionModel.updateOne({ sectionId: '7' }, { $set: { evidence: [] } })

    const m = await marshBot(api)

    expect(m.generation).toEqual({ kind: 'ready', step: 3, parts: ['7', '4', '5', '2'] })
    expect(m.says).toEqual([
      'The last sections are ready to draft from your input.',
      "Section 7 is out of date, so it's redrafted too. Drafting 4 sections runs in the background and takes a few minutes. Start it from Generation.",
    ])
    expect(m.cta).toEqual({ label: 'Open Generation', link: { tab: 'generate' } })
  })
})

describe('Generate-stage links (GN-13)', () => {
  it('sends figures and draft questions to the section in Review, the rest to Generation', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    // While drafting, the next step only informs, so "What else?" brings up the Sections
    // outline; once the engineer must act it offers no "What else?" (board 18).
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    fakeS4((call) => (call.route.startsWith('/assistant') ? undefined : held.then(() => undefined)))
    await api.post(`${generation}/run`).expect(202)
    await refreshBrief(REF)
    expect(await marshBotOutline(api)).not.toBeNull()
    release()
    await drainInlineJobs()
    await refreshBrief(REF)

    const items = (await AssistantBriefModel.findOne({ reference: REF }).lean())!.items.filter(
      (i) => !i.resolvedAt,
    )
    const link = (id: string) => items.find((i) => i.id === id)?.link
    expect(link('generate.figures:4')).toEqual({ tab: 'review', params: { section: '4' } })
    expect(link('generate.figures:5')).toEqual({ tab: 'review', params: { section: '5' } })
    expect(link('generate.no-ofi')).toEqual({ tab: 'review', params: { section: '3' } })
    expect(link('generate.not-drafted')).toEqual({ tab: 'generate' })

    // The outline turn rebuilt from the brief now.
    const outline = (await marshBotOutline(api))!
    expect(outline.items.find((i) => i.no === '7')?.link).toEqual({
      tab: 'review',
      params: { section: '7' },
    })
    expect(outline.items.find((i) => i.no === '4')?.link).toEqual({ tab: 'generate' })
    // Waiting on the engineer's input, the work is in Review.
    expect(outline.cta).toEqual({ label: 'Open Review', link: { tab: 'review' } })
  })
})

// The Sections outline, raised by "What else?" after the next step.
async function marshBotOutline(api: Api) {
  await api.get(assistant).expect(200)
  await settleBackground()
  let t = (await api.get(assistant).expect(200)).body as AssistantThread
  if (t.replies.some((r) => r.id === 'what-else')) {
    const last = t.session.turns.at(-1)!.id
    await api.post(`${assistant}/replies`).send({ replyId: 'what-else', lastTurnId: last })
    await settleBackground()
    t = (await api.get(assistant).expect(200)).body as AssistantThread
  }
  const card = t.session.turns.flatMap((x) => x.cards).find((c) => c.type === 'outline')
  return card?.type === 'outline' ? card : null
}
