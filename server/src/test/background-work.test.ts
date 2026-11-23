// Background work (F-11) through GET /api/background-work: which of the user's
// long-running jobs are listed, with what state and progress, and where each
// row links to.
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { ObservationModel } from '../models/observation.model'
import { SiteWalkModel } from '../models/site-walk.model'
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
            photoReading: { status: 'interpreting', attempts: [{ startedAt: since }], photoIds: [] },
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
