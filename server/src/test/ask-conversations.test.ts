import { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import {
  AssistantConversationModel,
  MAX_CONVERSATION_QUESTIONS,
} from '../models/assistant-conversation.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { ReportCommentThreadModel } from '../models/report-comment.model'
import { ReportSectionModel } from '../models/report-section.model'
import { ReportSectionVersionModel } from '../models/report-section-version.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import type { UserRole } from '../models/user.model'
import { migrateAskConversations, OLD_COLLECTION } from '../scripts/migrate-ask-conversations'
import { resetChatLimits } from '../services/chat-limits.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// Keeping the Ask tab's questions in conversations (AS-03): per assessment and
// per user, private to that user; the latest opens first, a question without
// a conversation starts one, and one can be deleted; each answer keeps what
// the evaluation harness needs to replay it; nothing reaches the report; and
// an archived assessment's conversations are only read. S4 is a stubbed fetch.

useMemoryMongo()

const person = (name: string, role: UserRole = 'risk_engineer') => ({
  _id: new Types.ObjectId(),
  staffId: name,
  name,
  email: `${name.replace(' ', '.')}@example.com`,
  role,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const engineer = person('Alex Rowe')
const admin = person('Sana Patel', 'knowledge_admin')
const asEngineer = signedInAs(app, engineer)
const asAdmin = signedInAs(app, admin)

const REFERENCE = 'RPT-2026-0412'
const base = `/api/assessments/${REFERENCE}/ask`
const TRACE = {
  story: 'AS-01',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  prompt_version: 'as01-v1',
  pipeline: ['retrieve', 'assemble', 'generate', 'guardrail'],
  generated_at: '2026-11-13T06:00:00.000Z',
}
const event = (e: object) => `data: ${JSON.stringify(e)}\n\n`

// S4's stream for one answer citing the observation.
function answer(observationId: string) {
  const statement = {
    text: 'The B1 sprinkler control valve was found shut.',
    citations: [{ ref: `O:${observationId}`, kind: 'observation', quote: null, verified: true }],
  }
  const sources = {
    [`O:${observationId}`]: {
      id: observationId,
      COPE_dimension: ['Protection'],
      note: 'B1 sprinkler control valve found shut.',
    },
  }
  return (
    event({ type: 'step', step: 'retrieve' }) +
    event({ type: 'statement', ...statement, sources }) +
    event({
      type: 'result',
      value: {
        statements: [statement],
        missing: [],
        sources,
        confidence: 'high',
        error: null,
        usage: [],
        trace: TRACE,
      },
    })
  )
}

async function seedAssessment() {
  const site = await SiteModel.create({
    code: 'SITE-0002',
    name: 'Tuas Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const assessment = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    surveyType: 'First survey',
    engineer: engineer._id,
  })
  const session = await CaptureSessionModel.create({ assessment: assessment._id })
  const valve = await ObservationModel.create({
    assessment: assessment._id,
    session: session._id,
    engineer: engineer.name,
    note: 'B1 sprinkler control valve found shut.',
    recordings: [],
    severity: 'high',
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
  })
  const sent = vi.fn()
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    sent(JSON.parse(String(init!.body)))
    return new Response(answer(String(valve._id)))
  })
  return { assessment, valve, sent }
}

// The events a streamed response holds.
const eventsOf = (text: string) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)))

// Asks a question and returns its stream's events.
async function ask(as: typeof asEngineer, question: string, conversation?: string) {
  const res = await as.post(base).send(conversation ? { question, conversation } : { question })
  expect(res.status).toBe(200)
  return eventsOf(res.text)
}

// What the report holds, to show conversations change none of it (AC4).
async function reportNow() {
  const all = (docs: object[]) => JSON.stringify(docs)
  return {
    sections: all(await ReportSectionModel.find().lean()),
    versions: all(await ReportSectionVersionModel.find().lean()),
    reviews: all(await ReviewAuditModel.find().lean()),
    threads: await ReportCommentThreadModel.countDocuments(),
    assessment: all(await AssessmentModel.find().lean()),
  }
}

beforeEach(() => resetChatLimits())
afterEach(() => vi.unstubAllGlobals())

describe('stored per assessment and per user, private to that user (AC1)', () => {
  it('keeps a conversation in assistant_conversations with the metadata fields', async () => {
    const { assessment } = await seedAssessment()
    const [first] = await ask(asEngineer, '  Was the B1 valve shut?  ')
    expect(first.conversation).toMatchObject({ title: 'Was the B1 valve shut?', questions: 1 })
    const [second] = await ask(asEngineer, 'Which bay?', first.conversation.id)
    expect(second.conversation).toMatchObject({ id: first.conversation.id, questions: 2 })

    const stored = await AssistantConversationModel.collection.find().toArray()
    expect(stored).toHaveLength(1)
    const [conversation] = stored
    expect(String(conversation.assessment)).toBe(String(assessment._id))
    expect(String(conversation.userId)).toBe(String(engineer._id))
    expect(conversation.turns.map((t: { question: string }) => t.question)).toEqual([
      'Was the B1 valve shut?',
      'Which bay?',
    ])
    expect(conversation.metadata).toEqual({
      source_type: 'assistant_conversation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'all',
      effective_date: expect.any(Date),
    })
  })

  it("never shows a user another user's conversation, a knowledge admin's included", async () => {
    await seedAssessment()
    const [asked] = await ask(asEngineer, 'Was the B1 valve shut?')
    const id = asked.conversation.id

    const listed = await asAdmin.get(base)
    expect(listed.status).toBe(200)
    expect(listed.body).toMatchObject({ conversations: [], conversation: null, questions: [] })
    expect((await asAdmin.get(`${base}/conversations/${id}`)).status).toBe(404)
    expect((await asAdmin.delete(`${base}/conversations/${id}`)).status).toBe(404)
    // Asking into it starts nothing and is refused as a conversation that is not there.
    const into = await asAdmin.post(base).send({ question: 'Mine?', conversation: id })
    expect(into.status).toBe(404)
    expect(into.body).toMatchObject({
      cause: 'this conversation was deleted',
      next: 'Start a new conversation.',
    })
    expect(await AssistantConversationModel.countDocuments()).toBe(1)
  })
})

describe('the latest conversation, New conversation and Delete (AC2)', () => {
  it('opens on the latest conversation, lists the others, and opens one by its id', async () => {
    await seedAssessment()
    const [older] = await ask(asEngineer, 'When was the pump tested?')
    const [latest] = await ask(asEngineer, 'Was the B1 valve shut?')
    await ask(asEngineer, 'Which bay?', latest.conversation.id)
    const res = await asEngineer.get(base)
    expect(res.body.archived).toBe(false)
    expect(res.body.conversations.map((c: { title: string }) => c.title)).toEqual([
      'Was the B1 valve shut?',
      'When was the pump tested?',
    ])
    expect(res.body.conversation).toMatchObject({ id: latest.conversation.id, questions: 2 })
    expect(res.body.questions.map((q: { question: string }) => q.question)).toEqual([
      'Was the B1 valve shut?',
      'Which bay?',
    ])
    expect(res.body.scope).toMatchObject({ jurisdiction: 'SG', facilityType: 'Warehouse' })

    const opened = await asEngineer.get(`${base}/conversations/${older.conversation.id}`)
    expect(opened.status).toBe(200)
    expect(opened.body.conversation.title).toBe('When was the pump tested?')
    expect(opened.body.questions.map((q: { question: string }) => q.question)).toEqual([
      'When was the pump tested?',
    ])
    expect(opened.body.questions[0].observations).toHaveLength(1)

    // Asking again in the older one makes it the latest.
    await ask(asEngineer, 'And the jockey pump?', older.conversation.id)
    const after = await asEngineer.get(base)
    expect(after.body.conversation.id).toBe(older.conversation.id)
  })

  it('names a conversation from its first question, trimmed to 60 characters', async () => {
    await seedAssessment()
    const long =
      'Which observations concern the sprinkler control valves in the basement pump room?'
    const [asked] = await ask(asEngineer, long)
    expect(asked.conversation.title).toBe(
      'Which observations concern the sprinkler control valves in…',
    )
  })

  it('deletes a conversation for good, and the next latest opens', async () => {
    await seedAssessment()
    const [older] = await ask(asEngineer, 'When was the pump tested?')
    const [latest] = await ask(asEngineer, 'Was the B1 valve shut?')

    const res = await asEngineer.delete(`${base}/conversations/${latest.conversation.id}`)
    expect(res.status).toBe(204)
    expect(await AssistantConversationModel.exists({ _id: latest.conversation.id })).toBeNull()
    const listed = await asEngineer.get(base)
    expect(listed.body.conversations.map((c: { id: string }) => c.id)).toEqual([
      older.conversation.id,
    ])
    expect(listed.body.conversation.id).toBe(older.conversation.id)
    // Deleted already, or never there.
    expect(
      (await asEngineer.delete(`${base}/conversations/${latest.conversation.id}`)).status,
    ).toBe(404)
    expect((await asEngineer.get(`${base}/conversations/not-an-id`)).status).toBe(404)
  })

  it('refuses a question into a full conversation before anything is asked', async () => {
    const { sent } = await seedAssessment()
    const [asked] = await ask(asEngineer, 'Was the B1 valve shut?')
    const [turn] = (await AssistantConversationModel.findById(asked.conversation.id).lean())!.turns
    const more = Array.from({ length: MAX_CONVERSATION_QUESTIONS - 1 }, () => ({
      ...turn,
      _id: new Types.ObjectId(),
    }))
    await AssistantConversationModel.updateOne(
      { _id: asked.conversation.id },
      { $push: { turns: { $each: more } } },
    )
    sent.mockClear()
    const res = await asEngineer
      .post(base)
      .send({ question: 'One more?', conversation: asked.conversation.id })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      cause: `this conversation holds ${MAX_CONVERSATION_QUESTIONS} questions, the most it can`,
      next: 'Start a new conversation.',
    })
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('what each answer keeps for the evaluation harness (AC3)', () => {
  it('stores the cited sources, the provider, the model and the timestamps', async () => {
    const { valve } = await seedAssessment()
    const before = Date.now()
    await ask(asEngineer, 'Was the B1 valve shut?')
    const [conversation] = await AssistantConversationModel.find().lean()
    const [turn] = conversation.turns
    expect(turn.sources).toEqual({
      [`O:${valve._id}`]: {
        id: String(valve._id),
        COPE_dimension: ['Protection'],
        note: 'B1 sprinkler control valve found shut.',
      },
    })
    expect(turn.statements[0].citations[0].ref).toBe(`O:${valve._id}`)
    expect(turn).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      promptVersion: 'as01-v1',
      status: 'complete',
      trace: TRACE,
    })
    expect(turn.askedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(turn.answeredAt!.getTime()).toBeGreaterThanOrEqual(turn.askedAt.getTime())
    // The browser never gets the trace, provider or model.
    const listed = await asEngineer.get(base)
    expect(JSON.stringify(listed.body)).not.toMatch(/as01-v1|claude-opus|"provider"/)
  })

  it('keeps an unanswered question with no provider or model when S4 cannot be reached', async () => {
    await seedAssessment()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    await ask(asEngineer, 'Was the B1 valve shut?')
    const [conversation] = await AssistantConversationModel.find().lean()
    expect(conversation.turns[0]).toMatchObject({
      status: 'failed',
      provider: null,
      model: null,
      trace: null,
    })
    expect(conversation.turns[0].answeredAt).toBeInstanceOf(Date)
  })
})

describe('never part of the report (AC4)', () => {
  it('adds no version and changes no review state when asking or deleting', async () => {
    await seedAssessment()
    const before = await reportNow()
    const [asked] = await ask(asEngineer, 'Was the B1 valve shut?')
    await ask(asEngineer, 'Which bay?', asked.conversation.id)
    await asEngineer.delete(`${base}/conversations/${asked.conversation.id}`)
    expect(await reportNow()).toEqual(before)
  })
})

describe('an archived assessment (AC5)', () => {
  it('reads its conversations, and refuses every write with 409', async () => {
    const { assessment, sent } = await seedAssessment()
    const [asked] = await ask(asEngineer, 'Was the B1 valve shut?')
    await AssessmentModel.updateOne({ _id: assessment._id }, { archivedAt: new Date() })
    sent.mockClear()

    const listed = await asEngineer.get(base)
    expect(listed.status).toBe(200)
    expect(listed.body.archived).toBe(true)
    expect(listed.body.questions).toHaveLength(1)
    expect((await asEngineer.get(`${base}/conversations/${asked.conversation.id}`)).status).toBe(
      200,
    )

    for (const body of [
      { question: 'Which bay?', conversation: asked.conversation.id },
      { question: 'A new one?' },
    ]) {
      const res = await asEngineer.post(base).send(body)
      expect(res.status).toBe(409)
      expect(res.body).toMatchObject({
        cause: 'the assessment is archived, so its conversations are read only',
        next: 'Restore the assessment to ask about it again.',
      })
    }
    expect((await asEngineer.delete(`${base}/conversations/${asked.conversation.id}`)).status).toBe(
      409,
    )
    expect(sent).not.toHaveBeenCalled()
    const [conversation] = await AssistantConversationModel.find().lean()
    expect(conversation.turns).toHaveLength(1)
    expect(await AssistantConversationModel.countDocuments()).toBe(1)
  })

  it('needs a session and the reports:ask permission for every route', async () => {
    await seedAssessment()
    const id = String(new Types.ObjectId())
    expect((await request(app).get(`${base}/conversations/${id}`)).status).toBe(401)
    expect((await request(app).delete(`${base}/conversations/${id}`)).status).toBe(401)
  })
})

describe('moving the questions saved before AS-03 (migrate:ask-conversations)', () => {
  it("puts each user's questions on an assessment into one conversation, then drops the old collection", async () => {
    const { assessment } = await seedAssessment()
    const other = new Types.ObjectId()
    const old = AssistantConversationModel.db.collection(OLD_COLLECTION)
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 6, minute))
    const question = (
      userId: Types.ObjectId,
      text: string,
      minute: number,
      status = 'complete',
    ) => ({
      _id: new Types.ObjectId(),
      assessment: assessment._id,
      userId,
      question: text,
      passage: null,
      status,
      statements: [],
      missing: [],
      sources: {},
      confidence: null,
      error: null,
      trace: status === 'answering' ? null : TRACE,
      metadata: {
        source_type: 'assessment_question',
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: 'all',
        effective_date: at(minute),
      },
      createdAt: at(minute),
      updatedAt: at(minute + 1),
    })
    const saved = [
      question(engineer._id, 'Was the B1 valve shut?', 0),
      question(other, 'Someone else asked', 1),
      question(engineer._id, 'Which bay?', 2),
      question(engineer._id, 'Still answering', 3, 'answering'),
    ]
    await old.insertMany(saved)

    expect(await migrateAskConversations()).toEqual({
      questions: 4,
      conversations: 2,
      dropped: true,
    })

    const mine = await AssistantConversationModel.findOne({ userId: engineer._id }).lean()
    expect(mine!.title).toBe('Was the B1 valve shut?')
    expect(mine!.createdAt).toEqual(at(0))
    expect(mine!.lastAskedAt).toEqual(at(3))
    expect(mine!.metadata.source_type).toBe('assistant_conversation')
    expect(mine!.turns.map((t) => String(t._id))).toEqual(
      [saved[0], saved[2], saved[3]].map((q) => String(q._id)),
    )
    expect(mine!.turns[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      promptVersion: 'as01-v1',
      askedAt: at(0),
      answeredAt: at(1),
    })
    expect(mine!.turns[2]).toMatchObject({ provider: null, answeredAt: null })
    const collections = await AssistantConversationModel.db.db!.listCollections().toArray()
    expect(collections.map((c) => c.name)).not.toContain(OLD_COLLECTION)

    // The tab opens on them as before.
    const listed = await asEngineer.get(base)
    expect(listed.body.questions.map((q: { question: string }) => q.question)).toEqual([
      'Was the B1 valve shut?',
      'Which bay?',
      'Still answering',
    ])

    // Running it again changes nothing.
    expect(await migrateAskConversations()).toEqual({
      questions: 0,
      conversations: 0,
      dropped: false,
    })
    expect(await AssistantConversationModel.countDocuments()).toBe(2)
  })
})
