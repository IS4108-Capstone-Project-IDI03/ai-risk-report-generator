// Background work (F-11) through GET /api/background-work: which of the user's
// long-running jobs are listed, with what state and progress, and where each
// row links to.
import type { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { SiteWalkModel } from '../models/site-walk.model'
import { signedInAs } from './auth-test-helpers'
import { REF, assessment, people } from './generation-fixtures'
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
