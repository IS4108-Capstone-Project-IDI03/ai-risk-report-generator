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
})
