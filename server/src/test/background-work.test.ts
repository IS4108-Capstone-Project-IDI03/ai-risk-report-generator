// Background work (F-11) through GET /api/background-work: which of the user's
// long-running jobs are listed, with what state and progress, and where each
// row links to.
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { DraftingRunModel } from '../models/drafting-run.model'
import { IngestionJobModel } from '../models/ingestion-job.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ObservationModel } from '../models/observation.model'
import { SiteWalkModel } from '../models/site-walk.model'
import { UserModel } from '../models/user.model'
import { signedInAs } from './auth-test-helpers'
import { REF, assessment, observation, people } from './generation-fixtures'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const recording = (seq: number, status: string) => ({
  seq,
  key: `walks/${seq}.webm`,
  contentType: 'audio/webm',
  size: 1000,
  durationSec: 60,
  transcription: { status, segments: [] },
})

function walk(assessmentId: Types.ObjectId, engineerId: Types.ObjectId, fields: object) {
  return SiteWalkModel.create({
    assessment: assessmentId,
    engineerId,
    metadata: {
      source_type: 'site_walk',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: null,
      effective_date: new Date(),
    },
    ...fields,
  })
}

describe('site walks', () => {
  it('an engineer sees their walk recordings being transcribed', async () => {
    const { engineer } = await people()
    const { id: assessmentId } = await assessment(engineer._id)
    const created = await walk(assessmentId, engineer._id, {
      status: 'transcribing',
      name: 'Morning walk',
      recordings: [recording(1, 'transcribed'), recording(2, 'transcribing')],
    })

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'walk',
        state: 'running',
        title: 'Morning walk',
        context: { label: 'Jurong Cold Store', reference: REF },
        progress: { type: 'stages', current: 1, total: 2, unit: 'recordings' },
        href: `/assessment?ref=${REF}&tab=observations&walk=${created._id}`,
      }),
    ])
  })

  it('a walk being proposed shows as one AI call, timed from when proposing began', async () => {
    const { engineer } = await people()
    const { id: assessmentId } = await assessment(engineer._id)
    const created = await walk(assessmentId, engineer._id, {
      status: 'proposing',
      recordings: [recording(1, 'transcribed')],
    })
    // The walk's last change is the move to proposing.
    const proposingSince = new Date('2026-11-23T09:00:00Z')
    await SiteWalkModel.collection.updateOne(
      { _id: created._id },
      { $set: { updatedAt: proposingSince } },
    )

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        state: 'running',
        title: 'Site walk',
        progress: { type: 'working', stage: 'Proposing observations' },
        startedAt: proposingSince.toISOString(),
      }),
    ])
  })

  it('a failed walk shows its reason and how to try again', async () => {
    const { engineer } = await people()
    const { id: assessmentId } = await assessment(engineer._id)
    const created = await walk(assessmentId, engineer._id, {
      status: 'failed',
      error: 'A recording could not be transcribed.',
      recordings: [recording(1, 'failed')],
    })

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        state: 'failed',
        error: 'A recording could not be transcribed.',
        retry: {
          method: 'POST',
          url: `/api/assessments/${REF}/site-walks/${created._id}/retry`,
        },
      }),
    ])
  })

  // Regression: passed from the start, since only working or failed walks are read.
  it('walks being recorded, ready to review or created are not listed', async () => {
    const { engineer } = await people()
    const { id: assessmentId } = await assessment(engineer._id)
    for (const status of ['recording', 'ready', 'created'])
      await walk(assessmentId, engineer._id, { status })

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([])
  })
})

describe('observations', () => {
  it('a voice note being transcribed shows as one AI call, timed from its attempt', async () => {
    const { engineer } = await people()
    const ids = await assessment(engineer._id)
    const saved = await observation(ids, ['Protection'], { transcribing: true })
    const since = new Date('2026-11-23T09:00:00Z')
    await ObservationModel.collection.updateOne(
      { _id: saved._id },
      { $set: { 'recordings.0.transcription.attempts.0.startedAt': since } },
    )

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'voice-note',
        state: 'running',
        title: 'Voice note',
        context: { label: 'Jurong Cold Store', reference: REF },
        progress: { type: 'working', stage: 'Transcribing' },
        startedAt: since.toISOString(),
        href: `/assessment?ref=${REF}&tab=observations&obs=${saved._id}`,
      }),
    ])
  })

  it('a voice note whose transcription failed shows the reason and how to try again', async () => {
    const { engineer } = await people()
    const ids = await assessment(engineer._id)
    const saved = await observation(ids, ['Protection'], { transcribing: true })
    await ObservationModel.collection.updateOne(
      { _id: saved._id },
      {
        $set: {
          'recordings.0.transcription.status': 'failed',
          'recordings.0.transcription.error': 'The recording has no speech in it.',
        },
      },
    )
    const recordingId = saved.recordings[0]._id

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'voice-note',
        state: 'failed',
        error: expect.any(String),
        retry: {
          method: 'POST',
          url: `/api/observations/${saved._id}/recordings/${recordingId}/transcription/retry`,
        },
      }),
    ])
  })

  it('a handwritten page being transcribed shows as one AI call, timed from its attempt', async () => {
    const { engineer } = await people()
    const ids = await assessment(engineer._id)
    const saved = await observation(ids, ['Protection'])
    const since = new Date('2026-11-23T09:00:00Z')
    await ObservationModel.collection.updateOne(
      { _id: saved._id },
      {
        $set: {
          pages: [
            {
              _id: new Types.ObjectId(),
              name: 'Page 1',
              key: 'pages/p1.jpg',
              contentType: 'image/jpeg',
              size: 3,
              transcription: { status: 'transcribing', attempts: [{ startedAt: since }] },
            },
          ],
        },
      },
    )

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'handwriting',
        state: 'running',
        title: 'Page 1',
        progress: { type: 'working', stage: 'Reading handwriting' },
        startedAt: since.toISOString(),
        href: `/assessment?ref=${REF}&tab=observations&obs=${saved._id}`,
      }),
    ])
  })

  // Regression: passed from the start, since listObservationsOf leaves drafts out (CP-24).
  it("a draft observation's voice note is not listed", async () => {
    const { engineer } = await people()
    const ids = await assessment(engineer._id)
    const saved = await observation(ids, ['Protection'], { transcribing: true })
    await ObservationModel.collection.updateOne({ _id: saved._id }, { $set: { draft: true } })

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([])
  })
})

describe('reading an observation (CP-24)', () => {
  it('photos being described show as one AI call, timed from the attempt', async () => {
    const { engineer } = await people()
    const ids = await assessment(engineer._id)
    const saved = await observation(ids, ['Protection'])
    const since = new Date('2026-11-23T09:00:00Z')
    await ObservationModel.collection.updateOne(
      { _id: saved._id },
      {
        $set: {
          interpretation: {
            photoReading: {
              status: 'interpreting',
              attempts: [{ startedAt: since }],
              photoIds: [],
            },
          },
        },
      },
    )

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'reading',
        state: 'running',
        title: 'Observation',
        progress: { type: 'working', stage: 'Describing photos' },
        startedAt: since.toISOString(),
        href: `/assessment?ref=${REF}&tab=observations&obs=${saved._id}`,
      }),
    ])
  })

  it('a failed suggestion shows its reason and how to try again', async () => {
    const { engineer } = await people()
    const ids = await assessment(engineer._id)
    const saved = await observation(ids, ['Protection'])
    await ObservationModel.collection.updateOne(
      { _id: saved._id },
      {
        $set: {
          suggestion: {
            status: 'failed',
            error: 'The category and severity could not be suggested.',
            attempts: 2,
            category: null,
            severity: null,
            run: 1,
          },
        },
      },
    )

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'reading',
        state: 'failed',
        error: 'The category and severity could not be suggested.',
        retry: { method: 'POST', url: `/api/observations/${saved._id}/suggestion/retry` },
      }),
    ])
  })
})

describe('drafting (GN-13)', () => {
  const job = (status: string, fields: object = {}) => ({
    status,
    action: 'draft',
    instruction: null,
    attempts: 0,
    error: null,
    requestedBy: { id: 'x', role: 'risk_engineer', name: 'Alex Rowe' },
    requestedAt: new Date('2026-11-23T09:00:00Z'),
    finishedAt: null,
    ...fields,
  })

  function draftingRun(
    assessmentId: Types.ObjectId,
    parts: Record<string, object>,
    run?: { parts: string[]; startedAt: Date; finishedAt: Date | null },
  ) {
    return DraftingRunModel.create({
      assessment: assessmentId,
      reference: REF,
      parts,
      ...(run && { run: { ...run, startedBy: { id: 'x', name: 'Alex Rowe' } } }),
      metadata: {
        source_type: 'drafting_run',
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: 'all',
        effective_date: new Date(),
      },
    })
  }

  it('a drafting run under way shows the parts drafted of the run', async () => {
    const { engineer } = await people()
    const { id } = await assessment(engineer._id)
    const startedAt = new Date('2026-11-23T09:00:00Z')
    await draftingRun(
      id,
      { '3': job('done'), '6': job('done'), '7': job('drafting'), '8': job('queued') },
      { parts: ['3', '6', '7', '8'], startedAt, finishedAt: null },
    )

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'drafting',
        state: 'running',
        title: 'Drafting the report',
        context: { label: 'Jurong Cold Store', reference: REF },
        progress: { type: 'stages', current: 2, total: 4, unit: 'parts' },
        startedAt: startedAt.toISOString(),
        href: `/assessment?ref=${REF}&tab=generate`,
      }),
    ])
  })

  it('a part that failed, once the run is over, shows its reason and where to draft it again', async () => {
    const { engineer } = await people()
    const { id } = await assessment(engineer._id)
    await draftingRun(
      id,
      {
        '3': job('done'),
        '7': job('failed', { error: 'Section 7 could not be drafted.', attempts: 3 }),
      },
      {
        parts: ['3', '7'],
        startedAt: new Date('2026-11-23T09:00:00Z'),
        finishedAt: new Date('2026-11-23T09:05:00Z'),
      },
    )

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'drafting',
        state: 'failed',
        title: 'Section 7',
        error: 'Section 7 could not be drafted.',
        href: `/assessment?ref=${REF}&tab=generate`,
      }),
    ])
    // Drafting it again is the drafting tab's choice: a new run drafts what its checkpoint offers.
    expect(res.body.rows[0].retry).toBeUndefined()
  })

  it('a part redrafted from Review shows as one AI call, timed from the request', async () => {
    const { engineer } = await people()
    const { id } = await assessment(engineer._id)
    const requestedAt = new Date('2026-11-23T10:00:00Z')
    await draftingRun(
      id,
      { '7': job('drafting', { action: 'regenerate', requestedAt }), '9': job('queued') },
      {
        parts: ['7', '9'],
        startedAt: new Date('2026-11-23T09:00:00Z'),
        finishedAt: new Date('2026-11-23T09:05:00Z'),
      },
    )

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        state: 'running',
        title: 'Section 7',
        progress: { type: 'working', stage: 'Drafting' },
        startedAt: requestedAt.toISOString(),
      }),
      expect.objectContaining({ state: 'queued', title: 'Section 9' }),
    ])
  })
})

describe('who sees what', () => {
  const transcribing = { status: 'transcribing', recordings: [recording(1, 'transcribing')] }

  it("an archived assessment's work is not listed", async () => {
    const { engineer } = await people()
    const { id } = await assessment(engineer._id)
    await walk(id, engineer._id, transcribing)
    await AssessmentModel.updateOne({ _id: id }, { archivedAt: new Date() })

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([])
  })

  // Regression: passed from the start, since only the user's assigned assessments are read.
  it("an engineer never sees another engineer's work", async () => {
    const { engineer } = await people()
    const other = await UserModel.create({
      staffId: 'T-3',
      name: 'Jide Okafor',
      email: 'jide@example.com',
      role: 'risk_engineer',
    })
    const { id } = await assessment(engineer._id)
    await walk(id, engineer._id, transcribing)

    const res = await signedInAs(app, other).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([])
  })

  // Regression: passed from the start, from requireAuthNoRefresh.
  it('answers 401 when signed out', async () => {
    await request(app).get('/api/background-work').expect(401)
  })

  // Regression: passed from the start. Polling must not keep an idle session alive (F-07).
  it('reading it does not extend the session', async () => {
    const { engineer } = await people()

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.headers['set-cookie']).toBeUndefined()
  })
})

describe('knowledge admins', () => {
  // Regression: passed from the start, since every role reads only its own assigned assessments.
  it("an admin sees work on assessments assigned to them, not on an engineer's", async () => {
    const { engineer, admin } = await people()
    const { id } = await assessment(engineer._id)
    await walk(id, engineer._id, {
      status: 'transcribing',
      recordings: [recording(1, 'transcribing')],
    })

    const res = await signedInAs(app, admin).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([])
  })

  const upload = (title: string, fields: object = {}) =>
    KnowledgeDocumentModel.create({
      title,
      issuingBody: 'FM Global',
      fileName: `${title}.pdf`,
      file: { key: `k/${title}.pdf`, contentType: 'application/pdf', size: 1, sha256: title },
      status: 'processing',
      unconfirmed: [],
      metadata: {
        source_type: 'fm_standard',
        jurisdiction: 'all',
        facility_type: 'all',
        effective_date: new Date('2026-01-01'),
      },
      ...fields,
    })

  it('a document being ingested shows its stage and the pages done in it', async () => {
    const { admin } = await people()
    const document = await upload('FM 8-9')
    const stageStarted = new Date('2026-11-23T09:02:00Z')
    await IngestionJobModel.create({
      documentId: document._id,
      currentStage: 'chunking',
      pageCurrent: 12,
      pageTotal: 40,
      ocrCurrent: null,
      ocrTotal: null,
      stageLog: [
        { stage: 'parsing', startedAt: new Date('2026-11-23T09:00:00Z'), durationMs: 120000 },
      ],
      currentStageStartedAt: stageStarted,
      startedAt: new Date('2026-11-23T09:00:00Z'),
      updatedAt: new Date(),
    })

    const res = await signedInAs(app, admin).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'ingestion',
        state: 'running',
        title: 'FM 8-9',
        context: { label: 'Knowledge base' },
        progress: {
          type: 'count',
          current: 12,
          total: 40,
          unit: 'pages',
          stage: 'Chunking',
          step: 2,
          steps: 3,
        },
        startedAt: stageStarted.toISOString(),
        href: '/admin/knowledge-base',
      }),
    ])
  })

  it('a document waiting for the ingestion worker says queued, timed from its upload', async () => {
    const { admin } = await people()
    const document = await upload('FM 2-0', { status: 'queued' })

    const res = await signedInAs(app, admin).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'ingestion',
        state: 'queued',
        title: 'FM 2-0',
        progress: { type: 'working', stage: 'Queued' },
        startedAt: document.createdAt.toISOString(),
      }),
    ])
  })

  it("chunking's OCR pass counts the table and formula regions read", async () => {
    const { admin } = await people()
    const document = await upload('FM 8-9')
    await IngestionJobModel.create({
      documentId: document._id,
      currentStage: 'chunking',
      pageCurrent: 40,
      pageTotal: 40,
      ocrCurrent: 3,
      ocrTotal: 8,
      stageLog: [],
      currentStageStartedAt: new Date(),
      startedAt: new Date(),
      updatedAt: new Date(),
    })

    const res = await signedInAs(app, admin).get('/api/background-work').expect(200)

    expect(res.body.rows[0].progress).toMatchObject({
      type: 'count',
      current: 3,
      total: 8,
      unit: 'regions',
      stage: 'Chunking',
    })
  })

  it('a failed ingestion shows its reason and how to try again', async () => {
    const { admin } = await people()
    const document = await upload('FM 8-9', {
      status: 'failed',
      error: 'The PDF could not be read.',
      finishedAt: new Date(),
    })

    const res = await signedInAs(app, admin).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([
      expect.objectContaining({
        kind: 'ingestion',
        state: 'failed',
        error: 'The PDF could not be read.',
        retry: { method: 'POST', url: `/api/knowledge-documents/${document._id}/retry` },
      }),
    ])
  })

  // Regression: passed from the start, since only queued or processing uploads become rows.
  it('complete and cancelled documents are not listed', async () => {
    const { admin } = await people()
    await upload('FM 8-9', { status: 'complete', finishedAt: new Date() })
    await upload('FM 2-0', { status: 'cancelled', cancelledAt: new Date() })

    const res = await signedInAs(app, admin).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([])
  })

  // Regression: passed from the start. Uploads are the admins' (knowledge:manage).
  it('an engineer sees no uploads', async () => {
    const { engineer } = await people()
    await upload('FM 8-9', { status: 'queued' })

    const res = await signedInAs(app, engineer).get('/api/background-work').expect(200)

    expect(res.body.rows).toEqual([])
  })
})
