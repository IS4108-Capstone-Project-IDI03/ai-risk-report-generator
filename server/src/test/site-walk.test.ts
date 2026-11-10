// Site walks (CP-22) through the HTTP routes: lifecycle, uploads, ordering,
// proposal checks, Create all and the retried transcription queue. S3 is a map;
// S5 and rag-service are a stubbed fetch; BullMQ runs jobs in-process under tests.
import http from 'http'
import { Types } from 'mongoose'
import type { AddressInfo } from 'net'
import { PassThrough, Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { NotificationModel } from '../models/notification.model'
import { ObservationModel } from '../models/observation.model'
import { SiteWalkModel } from '../models/site-walk.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { proposalQueue, transcriptionQueue } from '../services/background-queues.service'
import { drainInlineJobs, setInlineAttempts } from '../services/job-queue.service'
import { signSession } from '../services/auth.service'
import { SESSION_COOKIE } from '../middleware/auth.middleware'
import { resumeInterruptedSiteWalks, runWalkTranscription } from '../services/site-walk.service'
import * as mediaConvert from '../services/media-convert.service'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import sharp from 'sharp'
import { readFileSync } from 'fs'
import {
  aacAudio,
  audioFile,
  bmpImage,
  aiffAudio,
  mp3Audio,
  silentAudio,
  wavAudio,
  webmAudio,
} from './media-fixtures'
import { useMemoryMongo } from './memory-mongo'

const s3 = vi.hoisted(() => new Map<string, Buffer>())
// A stream to serve in place of the stored file, for the streaming tests.
const served = vi.hoisted(() => ({ stream: null as import('stream').Readable | null }))
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string, body: Buffer) => void s3.set(key, body),
  getObjectStream: async (key: string, range?: { start: number; end: number }) =>
    served.stream ??
    Readable.from([range ? s3.get(key)!.subarray(range.start, range.end + 1) : s3.get(key)]),
  deleteObject: async (key: string) => void s3.delete(key),
}))

useMemoryMongo()

const actor = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, actor)
const REF = 'RPT-2026-0501'
const base = `/api/assessments/${REF}/site-walks`
type Draft = { locations: Record<string, unknown>[]; observations: Record<string, unknown>[] }
const BLOCK_A_BAY = new Types.ObjectId()

const AUDIO = webmAudio()
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('jpeg body')])

const speech = vi.fn<(body: { s3_key: string }) => Promise<Response>>()
const describe_ = vi.fn<(body: { s3_key: string }) => Promise<Response>>()
type RagBody = {
  report_id: string
  transcript: { kind: string; text?: string; recordings: { seq: number; duration_sec?: number }[] }
  existing_locations: unknown[]
  photos: unknown[]
  site_name: string | null
  privacy: unknown
}
const rag = vi.fn<(body: RagBody) => Promise<Response>>()
const json = (status: number, body: object) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
const heard = (text: string) =>
  json(200, { transcript: text, segments: [{ start: 0, end: 5, text }], usage: [] })

beforeEach(async () => {
  // The notification looks the engineer's role up (F-10), so the account must exist.
  await UserModel.create(actor)
  speech.mockImplementation(() => heard('We are at Block A, pallets in the fire lane.'))
  describe_.mockImplementation(() =>
    json(200, { description: 'Pallets stacked in an aisle.', usage: [] }),
  )
  rag.mockImplementation(() => json(200, proposalFromRag()))
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/transcribe')) return speech(body)
    if (url.endsWith('/describe-photo')) return describe_(body)
    if (url.endsWith('/site-walks/propose')) return rag(body)
    throw new Error(`Unexpected call to ${url}`)
  })
})
afterEach(async () => {
  await drainInlineJobs()
  setInlineAttempts(1)
  vi.restoreAllMocks()
  served.stream = null
  s3.clear()
  for (const m of [speech, describe_, rag]) m.mockReset()
  vi.unstubAllGlobals()
})

// What rag-service answers: one new building location and one observation there.
function proposalFromRag(photoIds: string[] = []) {
  return {
    locations: [
      {
        ref: 'loc-1',
        existing_id: null,
        kind: 'building',
        building: 'Block A',
        floor: 'L1',
        name: 'Loading bay',
      },
    ],
    observations: [
      {
        ref: 'obs-1',
        note: 'Pallets block the fire lane.',
        cope_dimension: 'Protection',
        severity: 'high',
        location_ref: 'loc-1',
        recording_seq: 1,
        start: 0,
        end: 5,
        photo_ids: photoIds,
        check: { severity: false, category: true, location: false },
      },
    ],
    usage: [],
  }
}
const PHOTO = '11111111-1111-4111-8111-111111111111'

async function seed() {
  const site = await SiteModel.create({
    code: 'SITE-1',
    name: 'Tilbury DC',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  return AssessmentModel.create({
    reference: REF,
    site: site._id,
    client: 'Acme Logistics',
    surveyType: 'Property risk survey',
    engineer: actor._id,
    locations: [{ _id: BLOCK_A_BAY, name: 'Bay 3', building: 'Block B', key: 'bay 3||block b' }],
  })
}

const startWalk = async () => (await api.post(base)).body
const upload = (id: string, seq: number, duration = 12) =>
  api
    .put(`${base}/${id}/recordings/${seq}`)
    .field('durationSec', String(duration))
    .attach('recording', AUDIO, { filename: `r${seq}.webm`, contentType: 'audio/webm' })
const uploadPhoto = (id: string, photoId = PHOTO) =>
  api
    .put(`${base}/${id}/photos/${photoId}`)
    .field('recordingSeq', '1')
    .field('offsetSec', '3.5')
    .attach('photo', JPG, { filename: 'p.jpg', contentType: 'image/jpeg' })

// Runs `action` just before the first site walk write whose update matches, as
// another request landing at that moment would.
function beforeWrite(
  matches: (update: Record<string, Record<string, unknown>>) => boolean,
  action: () => Promise<unknown>,
) {
  let done = false
  for (const method of ['updateOne', 'findOneAndUpdate'] as const) {
    const original = SiteWalkModel[method].bind(SiteWalkModel) as (...args: unknown[]) => {
      exec: () => Promise<unknown>
    }
    vi.spyOn(SiteWalkModel, method).mockImplementation(((...args: unknown[]) => {
      const query = original(...args)
      if (done || !matches((args[1] ?? {}) as never)) return query
      done = true
      const exec = query.exec.bind(query)
      query.exec = async () => (await action(), exec())
      return query
    }) as never)
  }
}

// Waits for the walk to reach a status (jobs run in the background).
async function reaches(id: string, status: string) {
  await vi.waitFor(async () => expect((await api.get(`${base}/${id}`)).body.status).toBe(status))
  return (await api.get(`${base}/${id}`)).body
}

// A finished, proposed walk ready for review.
async function readyWalk() {
  await seed()
  const walk = await startWalk()
  await upload(walk.id, 1)
  await uploadPhoto(walk.id)
  rag.mockImplementation(() => json(200, proposalFromRag([PHOTO])))
  await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
  return reaches(walk.id, 'ready')
}

describe('walk lifecycle', () => {
  it('starts a walk and reuses the one still being recorded', async () => {
    await seed()
    const first = await api.post(base)
    const second = await api.post(base)

    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({
      status: 'recording',
      recordings: [],
      photos: [],
      proposal: null,
    })
    expect(second.status).toBe(200)
    expect(second.body.id).toBe(first.body.id)
    const stored = await SiteWalkModel.findById(first.body.id).lean()
    expect(stored?.metadata).toMatchObject({
      source_type: 'site_walk',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: null,
    })
  })

  // RV-11: the walk follows the assessment, so the new engineer finishes the old one's
  // recordings instead of starting a second walk beside it.
  it('gives the new engineer the walk still recording after a reassignment', async () => {
    await seed()
    const first = await startWalk()
    const next = { _id: new Types.ObjectId(), role: 'risk_engineer', name: 'New Engineer' }
    await AssessmentModel.updateOne({ reference: REF }, { engineer: next._id })

    const res = await signedInAs(app, next as never).post(base)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(first.id)
    expect(await SiteWalkModel.countDocuments()).toBe(1)
  })

  it('lets only the assigned engineer start a walk', async () => {
    await seed()
    const other = signedInAsRole(app, 'risk_engineer', 'Someone Else')
    expect((await other.post(base)).status).toBe(403)
    expect((await api.post('/api/assessments/NOPE/site-walks')).status).toBe(404)
  })

  // Round 3: created walks are listed too, so the list can show them folded away.
  it('lists walks newest first, created ones included', async () => {
    await seed()
    const walk = await startWalk()
    const created = await SiteWalkModel.create({
      assessment: (await AssessmentModel.findOne())!._id,
      engineerId: actor._id,
      createdAt: new Date(Date.now() - 60_000),
      status: 'created',
      metadata: {
        source_type: 'site_walk',
        jurisdiction: 'SG',
        facility_type: 'W',
        effective_date: new Date(),
      },
    })

    const list = await api.get(base)

    expect(list.body.map((w: { id: string }) => w.id)).toEqual([walk.id, String(created._id)])
    expect((await api.get(`${base}/${walk.id}`)).body.id).toBe(walk.id)
    expect((await api.get(`${base}/${new Types.ObjectId()}`)).status).toBe(404)
  })

  // Walks follow the assessment, not the engineer who started them (RV-11): after a
  // reassignment the new engineer carries on the walks already made.
  it('lists the assessment’s walks, whoever started them, newest first', async () => {
    await seed()
    const mine = await startWalk()
    const theirs = await SiteWalkModel.create({
      assessment: (await AssessmentModel.findOne())!._id,
      engineerId: new Types.ObjectId(),
      status: 'ready',
      metadata: {
        source_type: 'site_walk',
        jurisdiction: 'SG',
        facility_type: 'W',
        effective_date: new Date(),
      },
    })

    expect((await api.get(base)).body.map((w: { id: string }) => w.id)).toEqual([
      String(theirs._id),
      mine.id,
    ])
  })

  it('refuses another engineer changing a walk but lets them read it', async () => {
    await seed()
    const walk = await startWalk()
    const other = signedInAsRole(app, 'risk_engineer', 'Someone Else')

    expect((await other.get(`${base}/${walk.id}`)).status).toBe(200)
    expect(
      (await other.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })).status,
    ).toBe(403)
    expect((await other.delete(`${base}/${walk.id}`)).status).toBe(403)
  })

  it('refuses the walk engineer changing it once the assessment is reassigned', async () => {
    await seed()
    const walk = await startWalk()
    await api.put(`${base}/${walk.id}/text`).send({ text: 'Block A, pallets.' })
    await AssessmentModel.updateOne({ reference: REF }, { engineer: new Types.ObjectId() })

    expect(
      (await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })).status,
    ).toBe(403)
    expect((await api.get(`${base}/${walk.id}`)).status).toBe(200)
  })

  it('discards a walk that is not yet created, with its files', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    expect(s3.size).toBe(1)

    expect((await api.delete(`${base}/${walk.id}`)).status).toBe(204)

    expect(await SiteWalkModel.countDocuments()).toBe(0)
    expect(s3.size).toBe(0)
  })

  it('refuses to discard a walk once Create all has started, keeping its files', async () => {
    const walk = await readyWalk()
    await SiteWalkModel.updateOne(
      { _id: walk.id },
      { $set: { created: { observationIds: { 'obs-1': new Types.ObjectId() }, locationIds: {} } } },
    )
    const files = s3.size

    const response = await api.delete(`${base}/${walk.id}`)

    expect(response.status).toBe(409)
    expect(response.body.error).toContain('Create all has started')
    expect(await SiteWalkModel.countDocuments()).toBe(1)
    expect(s3.size).toBe(files)
  })
})

describe('uploads', () => {
  it('keeps a recording once per (walk, seq) and transcribes it without sending any hint', async () => {
    await seed()
    const walk = await startWalk()

    const first = await upload(walk.id, 1)
    const again = await upload(walk.id, 1)
    await drainInlineJobs()

    expect(first.status).toBe(200)
    expect(again.body.recordings).toHaveLength(1)
    expect(s3.size).toBe(1)
    expect(speech).toHaveBeenCalledTimes(1)
    expect(speech.mock.calls[0][0]).toEqual({ s3_key: expect.any(String) })
    const stored = await SiteWalkModel.findById(walk.id).lean()
    expect(stored?.recordings[0].transcription).toMatchObject({
      status: 'transcribed',
      text: 'We are at Block A, pallets in the fire lane.',
      segments: [{ start: 0, end: 5, text: 'We are at Block A, pallets in the fire lane.' }],
    })
  })

  it('serves a photo in parts when asked with a Range header', async () => {
    await seed()
    const walk = await startWalk()
    const { body } = await uploadPhoto(walk.id)
    const url = body.photos[0].url

    const part = await api.get(url).set('Range', 'bytes=3-5').buffer(true)
    const tail = await api.get(url).set('Range', 'bytes=-4').buffer(true)
    const beyond = await api.get(url).set('Range', `bytes=${JPG.length}-`)

    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 3-5/${JPG.length}`)
    expect(part.headers['accept-ranges']).toBe('bytes')
    expect(part.body).toEqual(JPG.subarray(3, 6))
    expect(tail.body).toEqual(JPG.subarray(JPG.length - 4))
    expect(beyond.status).toBe(416)
  })

  it('serves the whole file for a reversed range', async () => {
    await seed()
    const walk = await startWalk()
    const { body } = await uploadPhoto(walk.id)

    const reversed = await api.get(body.photos[0].url).set('Range', 'bytes=5-3').buffer(true)

    expect(reversed.status).toBe(200)
    expect(reversed.headers['content-length']).toBe(String(JPG.length))
    expect(reversed.body).toEqual(JPG)
  })

  it('ends the response, without crashing, when S3 fails part way through a file', async () => {
    await seed()
    const walk = await startWalk()
    const { body } = await uploadPhoto(walk.id)
    served.stream = new Readable({
      read() {
        this.push(JPG.subarray(0, 3))
        this.destroy(new Error('S3 connection reset'))
      },
    })

    const failed = await api
      .get(body.photos[0].url)
      .buffer(true)
      .then(
        () => null,
        (error: Error) => error,
      )

    expect(failed).toBeInstanceOf(Error)
    served.stream = null
    expect((await api.get(body.photos[0].url)).status).toBe(200)
  })

  it('stops reading the file from S3 when the browser cancels the request', async () => {
    await seed()
    const walk = await startWalk()
    const { body } = await uploadPhoto(walk.id)
    const source = new PassThrough()
    source.write(JPG.subarray(0, 3))
    served.stream = source
    const server = app.listen(0)
    try {
      const { port } = server.address() as AddressInfo
      const cookie = `${SESSION_COOKIE}=${signSession(actor)}`
      await new Promise<void>((resolve) => {
        const req = http.get(
          { port, path: body.photos[0].url, headers: { Cookie: cookie } },
          () => {
            req.destroy()
            resolve()
          },
        )
      })

      await vi.waitFor(() => expect(source.destroyed).toBe(true))
    } finally {
      server.close()
    }
  })

  it('refuses a recording whose walk was finished while it uploaded, so the phone keeps it', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    beforeWrite(
      (update) => Boolean(update.$push?.recordings),
      () =>
        SiteWalkModel.collection.updateOne(
          { _id: new Types.ObjectId(walk.id) },
          { $set: { status: 'transcribing' } },
        ),
    )

    const late = await upload(walk.id, 2)

    expect(late.status).toBe(409)
    const stored = await SiteWalkModel.findById(walk.id).lean()
    expect(stored!.recordings.map((r) => r.seq)).toEqual([1])
  })

  it('refuses a photo whose walk was finished while it uploaded, dropping the stored copy', async () => {
    await seed()
    const walk = await startWalk()
    beforeWrite(
      (update) => Boolean(update.$push?.photos),
      () =>
        SiteWalkModel.collection.updateOne(
          { _id: new Types.ObjectId(walk.id) },
          { $set: { status: 'transcribing' } },
        ),
    )

    const late = await uploadPhoto(walk.id)

    expect(late.status).toBe(409)
    expect((await SiteWalkModel.findById(walk.id).lean())!.photos).toEqual([])
    expect([...s3.keys()].some((k) => k.includes(PHOTO))).toBe(false)
  })

  it('accepts a resend whose recording another request stored first', async () => {
    await seed()
    const walk = await startWalk()
    const recording = {
      seq: 1,
      key: `audio/${REF}/site-walks/${walk.id}/1.webm`,
      contentType: 'audio/webm',
      size: AUDIO.length,
      durationSec: 12,
      transcription: { status: 'transcribed', segments: [] },
    }
    beforeWrite(
      (update) => Boolean(update.$push?.recordings),
      () =>
        SiteWalkModel.collection.updateOne({ _id: new Types.ObjectId(walk.id) }, {
          $push: { recordings: recording },
        } as never),
    )

    const resent = await upload(walk.id, 1)

    expect(resent.status).toBe(200)
    expect(resent.body.recordings).toHaveLength(1)
  })

  it('refuses a recording of the wrong type or no duration, and one after Finish', async () => {
    await seed()
    const walk = await startWalk()

    const wrongType = await api
      .put(`${base}/${walk.id}/recordings/1`)
      .field('durationSec', '5')
      .attach('recording', Buffer.from('not audio'), {
        filename: 'a.mp3',
        contentType: 'audio/mpeg',
      })
    const noDuration = await api
      .put(`${base}/${walk.id}/recordings/1`)
      .attach('recording', AUDIO, { filename: 'a.webm', contentType: 'audio/webm' })
    await upload(walk.id, 1)
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    const late = await upload(walk.id, 2)

    expect(wrongType.status).toBe(415)
    expect(noDuration.status).toBe(400)
    expect(late.status).toBe(409)
  })

  it('keeps a photo once per client id and refuses a non-image', async () => {
    await seed()
    const walk = await startWalk()

    await uploadPhoto(walk.id)
    const again = await uploadPhoto(walk.id)
    const bad = await api
      .put(`${base}/${walk.id}/photos/22222222-2222-4222-8222-222222222222`)
      .attach('photo', Buffer.from('not an image'), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })

    expect(again.body.photos).toEqual([
      expect.objectContaining({ id: PHOTO, recordingSeq: 1, offsetSec: 3.5 }),
    ])
    expect(bad.status).toBe(415)
    const image = await api.get(again.body.photos[0].url).buffer(true)
    expect(image.status).toBe(200)
    expect(image.body).toEqual(JPG)
  })

  it('keeps typed text while recording and replaces it', async () => {
    await seed()
    const walk = await startWalk()

    await api.put(`${base}/${walk.id}/text`).send({ text: 'first' })
    const second = await api.put(`${base}/${walk.id}/text`).send({ text: '  Block A, bay 1.  ' })

    expect(second.body.typedText).toBe('Block A, bay 1.')
    expect((await api.put(`${base}/${walk.id}/text`).send({})).status).toBe(400)
  })
})

describe('naming a walk (round 3)', () => {
  it('refuses to finish without a name and leaves the walk recording', async () => {
    await seed()
    const walk = await startWalk()
    await api.put(`${base}/${walk.id}/text`).send({ text: 'Block A, pallets.' })

    expect((await api.post(`${base}/${walk.id}/finish`)).status).toBe(400)
    expect((await api.post(`${base}/${walk.id}/finish`).send({ name: '   ' })).status).toBe(400)
    expect((await api.get(`${base}/${walk.id}`)).body.status).toBe('recording')
  })

  it('saves the name given at finish and shows it on the walk', async () => {
    await seed()
    const walk = await startWalk()
    expect(walk.name).toBeNull()
    await api.put(`${base}/${walk.id}/text`).send({ text: 'Block A, pallets.' })

    const finished = await api.post(`${base}/${walk.id}/finish`).send({ name: '  Tower A walk ' })
    expect(finished.status).toBe(200)
    expect(finished.body.name).toBe('Tower A walk')
  })

  it('renames a ready walk and a created one', async () => {
    const walk = await readyWalk()
    const renamed = await api.put(`${base}/${walk.id}/name`).send({ name: 'Warehouse walk' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.name).toBe('Warehouse walk')

    await SiteWalkModel.updateOne({ _id: walk.id }, { status: 'created' })
    const again = await api.put(`${base}/${walk.id}/name`).send({ name: 'Warehouse walk 2' })
    expect(again.status).toBe(200)
    expect((await api.get(`${base}/${walk.id}`)).body.name).toBe('Warehouse walk 2')
  })

  it('refuses a blank name on rename, and an unknown walk', async () => {
    const walk = await readyWalk()
    expect((await api.put(`${base}/${walk.id}/name`).send({ name: '  ' })).status).toBe(400)
    expect((await api.put(`${base}/${walk.id}/name`).send({})).status).toBe(400)
    const unknown = new Types.ObjectId()
    expect((await api.put(`${base}/${unknown}/name`).send({ name: 'X' })).status).toBe(404)
  })
})

describe('finishing and proposing', () => {
  it('refuses to finish a walk with nothing in it', async () => {
    await seed()
    const walk = await startWalk()
    expect(
      (await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })).status,
    ).toBe(400)
  })

  it('reads recordings in seq order whichever finishes first, then notifies the engineer', async () => {
    await seed()
    const walk = await startWalk()
    // Recording 1 finishes after recording 2.
    let finishFirst!: () => void
    speech.mockImplementation(({ s3_key }) =>
      s3_key.endsWith('/1.webm')
        ? new Promise<Response>((resolve) => {
            finishFirst = () =>
              resolve(
                new Response(
                  JSON.stringify({
                    transcript: 'one',
                    segments: [{ start: 0, end: 1, text: 'one' }],
                  }),
                ),
              )
          })
        : heard('two'),
    )
    await upload(walk.id, 2)
    await upload(walk.id, 1)
    await vi.waitFor(async () => {
      const w = (await api.get(`${base}/${walk.id}`)).body
      expect(w.recordings.find((r: { seq: number }) => r.seq === 2).transcription).toBe(
        'transcribed',
      )
    })

    const finished = await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    expect(finished.body.status).toBe('transcribing')
    expect(rag).not.toHaveBeenCalled()
    finishFirst()
    const ready = await reaches(walk.id, 'ready')

    const sent = rag.mock.calls[0][0]
    expect(sent.report_id).toBe(REF)
    expect(sent.transcript.recordings.map((r: { seq: number }) => r.seq)).toEqual([1, 2])
    // Each recording's length, so rag-service can place a photo in the whole walk.
    expect(sent.transcript.recordings.map((r) => r.duration_sec)).toEqual([12, 12])
    expect(ready.recordings.map((r: { seq: number }) => r.seq)).toEqual([1, 2])
    expect(ready.proposal.observations[0]).toMatchObject({
      copeDimension: 'Protection',
      severity: 'high',
      locationRef: 'loc-1',
      check: { category: true },
    })
    const note = await NotificationModel.findOne({ purpose: 'site_walk_ready' }).lean()
    expect(note).toMatchObject({
      kind: 'inbox',
      targetRole: 'risk_engineer',
      targetUserIds: [String(actor._id)],
      message: 'Review site walk: Tilbury DC',
    })
    expect(note?.context).toMatchObject({
      reference: REF,
      walkId: walk.id,
      client: 'Acme Logistics',
      site: 'Tilbury DC',
    })
    // Made by the app, not a person, so no sender.
    expect(note?.context).not.toHaveProperty('sender')
  })

  it('still notifies the engineer, once, when the notification write fails after the walk is ready', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    setInlineAttempts(2)
    // The first notification write fails, whichever way the service writes it.
    let failed = false
    const failOnce = () => {
      if (failed) return null
      failed = true
      throw new Error('Mongo is down.')
    }
    for (const method of ['create', 'findOneAndUpdate'] as const) {
      const original = NotificationModel[method].bind(NotificationModel) as (
        ...args: unknown[]
      ) => unknown
      vi.spyOn(NotificationModel, method).mockImplementation(
        ((...args: unknown[]) => failOnce() ?? original(...args)) as never,
      )
    }

    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')
    await drainInlineJobs()

    expect(failed).toBe(true)
    expect(await NotificationModel.countDocuments({ purpose: 'site_walk_ready' })).toBe(1)
  })

  it('skips transcribing for a typed walk and describes photos for the reading', async () => {
    await seed()
    const walk = await startWalk()
    await api
      .put(`${base}/${walk.id}/text`)
      .send({ text: 'Block A level 1, pallets in the fire lane.' })
    await uploadPhoto(walk.id)
    rag.mockImplementation(() =>
      json(200, {
        ...proposalFromRag(),
        observations: [
          { ...proposalFromRag().observations[0], recording_seq: null, start: null, end: null },
        ],
      }),
    )

    const finished = await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')

    expect(finished.body.status).toBe('proposing')
    expect(speech).not.toHaveBeenCalled()
    const sent = rag.mock.calls[0][0]
    expect(sent.transcript).toEqual({
      kind: 'typed',
      text: 'Block A level 1, pallets in the fire lane.',
    })
    expect(sent.photos).toEqual([
      { id: PHOTO, recording_seq: 1, offset_sec: 3.5, description: 'Pallets stacked in an aisle.' },
    ])
    expect(sent.existing_locations).toEqual([
      { id: String(BLOCK_A_BAY), building: 'Block B', floor: null, name: 'Bay 3' },
    ])
    expect(sent.site_name).toBe('Tilbury DC')
    expect(sent.privacy).toEqual({ enabled: false, known_entities: [] })
  })

  it('fails the walk with a reason when the reading keeps failing, and Retry runs it again', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    setInlineAttempts(2)
    rag.mockImplementation(() => json(502, { detail: 'The reading service is down.' }))

    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    const failed = await reaches(walk.id, 'failed')

    expect(failed.error).toBe('The reading service is down.')
    expect(rag).toHaveBeenCalledTimes(2)

    rag.mockImplementation(() => json(200, proposalFromRag()))
    const retried = await api.post(`${base}/${walk.id}/retry`)
    expect(retried.body.status).toBe('proposing')
    await reaches(walk.id, 'ready')
    expect((await api.post(`${base}/${walk.id}/retry`)).status).toBe(409)
  })

  it('sends each photo to be described with the reading privacy (PV-08)', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    await uploadPhoto(walk.id)

    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')

    expect(describe_.mock.calls[0][0]).toEqual({
      s3_key: expect.any(String),
      privacy: { enabled: false, known_entities: [], check_answers: false },
    })
  })

  it('still proposes when a photo cannot be described, matching it by time alone', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    await uploadPhoto(walk.id)
    setInlineAttempts(2)
    describe_.mockImplementation(() => json(502, { detail: 'The photo could not be described.' }))

    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')

    expect(rag.mock.calls[0][0].photos).toEqual([
      { id: PHOTO, recording_seq: 1, offset_sec: 3.5, description: '' },
    ])
  })

  it('retries a busy speech service instead of failing the walk', async () => {
    await seed()
    const walk = await startWalk()
    setInlineAttempts(3)
    speech
      .mockImplementationOnce(() => json(503, { detail: 'Busy.' }))
      .mockImplementationOnce(() => json(429, { detail: 'Slow down.' }))
      .mockImplementation(() => heard('Block A.'))

    await upload(walk.id, 1)
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')

    expect(speech).toHaveBeenCalledTimes(3)
  })

  it('names the reason on the walk when a recording is too large', async () => {
    await seed()
    const walk = await startWalk()
    speech.mockImplementation(() =>
      json(502, { detail: 'Whisper could not transcribe the recording: Error code: 413' }),
    )

    await upload(walk.id, 1)
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    const failed = await reaches(walk.id, 'failed')

    expect(failed.error).toBe(
      'Recording 1 could not be transcribed. The recording is too long or too large. Record it in shorter parts. Retry the walk.',
    )
  })

  it('fails the recording and the walk once the attempts run out, and Retry transcribes it again', async () => {
    await seed()
    const walk = await startWalk()
    setInlineAttempts(2)
    speech.mockImplementation(() => json(503, { detail: 'Busy.' }))

    await upload(walk.id, 1)
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    const failed = await reaches(walk.id, 'failed')

    expect(failed.recordings[0].transcription).toBe('failed')
    expect(failed.error).toMatch(/Recording 1 could not be transcribed/)

    speech.mockImplementation(() => heard('Block A.'))
    expect((await api.post(`${base}/${walk.id}/retry`)).body.status).toBe('transcribing')
    await reaches(walk.id, 'ready')
  })
})

describe('a database that keeps failing', () => {
  it('fails the recording once the attempts run out, so Retry transcribes it again', async () => {
    await seed()
    const walk = await startWalk()
    setInlineAttempts(2)
    const original = SiteWalkModel.updateOne.bind(SiteWalkModel) as (...args: unknown[]) => unknown
    const down = vi.spyOn(SiteWalkModel, 'updateOne').mockImplementation(((...args: unknown[]) => {
      const update = args[1] as { $set?: Record<string, unknown> }
      return update.$set?.['recordings.$.transcription.status'] === 'transcribing'
        ? Promise.reject(new Error('Mongo is down.'))
        : original(...args)
    }) as never)

    await upload(walk.id, 1)
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    const failed = await reaches(walk.id, 'failed')

    expect(failed.recordings[0].transcription).toBe('failed')
    down.mockRestore()
    await api.post(`${base}/${walk.id}/retry`)
    await reaches(walk.id, 'ready')
  })
})

// What rag-service answers for a typed walk: no recording to point at.
const typedProposal = () => {
  const typed = proposalFromRag()
  typed.observations[0].recording_seq = null as never
  return json(200, typed)
}

describe('retrying while BullMQ still holds the failed job', () => {
  it('queues a retried recording under a new job id', async () => {
    await seed()
    const walk = await startWalk()
    speech.mockImplementation(() => json(400, { detail: 'Bad audio.' }))
    await upload(walk.id, 1)
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'failed')
    speech.mockImplementation(() => heard('Block A.'))
    const add = vi.spyOn(transcriptionQueue, 'add')

    await api.post(`${base}/${walk.id}/retry`)
    await reaches(walk.id, 'ready')

    expect(add.mock.calls[0][0]).toMatch(new RegExp(`^sw-${walk.id}-1-retry-`))
  })

  it('queues a retried proposal under a new job id', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    rag.mockImplementation(() => json(502, { detail: 'The reading service is down.' }))
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'failed')
    rag.mockImplementation(() => json(200, proposalFromRag()))
    const add = vi.spyOn(proposalQueue, 'add')

    await api.post(`${base}/${walk.id}/retry`)
    await reaches(walk.id, 'ready')

    expect(add.mock.calls[0][0]).toMatch(new RegExp(`^swp-${walk.id}-retry-`))
  })
})

describe('typing and finishing at the same time', () => {
  it('refuses text saved after Finish moved the walk on, leaving the text unchanged', async () => {
    await seed()
    const walk = await startWalk()
    await api.put(`${base}/${walk.id}/text`).send({ text: 'Block A, pallets.' })
    vi.spyOn(proposalQueue, 'add').mockResolvedValue(undefined as never)
    beforeWrite(
      (update) => 'typedText' in update,
      () =>
        SiteWalkModel.collection.updateOne(
          { _id: new Types.ObjectId(walk.id) },
          { $set: { status: 'proposing' } },
        ),
    )

    const late = await api.put(`${base}/${walk.id}/text`).send({ text: 'Something else.' })

    expect(late.status).toBe(409)
    expect((await SiteWalkModel.findById(walk.id).lean())!.typedText).toBe('Block A, pallets.')
  })
})

describe('finishing while a recording fails', () => {
  it('queues a recording that failed after Finish read the walk but before it moved to transcribing', async () => {
    await seed()
    const walk = await startWalk()
    const add = vi.spyOn(transcriptionQueue, 'add').mockResolvedValue(undefined as never)
    await upload(walk.id, 1)
    add.mockClear()
    beforeWrite(
      (update) =>
        update.status === ('transcribing' as never) ||
        String(update.$set?.status) === 'transcribing',
      () =>
        SiteWalkModel.updateOne(
          { _id: walk.id },
          { 'recordings.0.transcription.status': 'failed' },
        ),
    )
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })

    expect(add).toHaveBeenCalledTimes(1)
    const stored = await SiteWalkModel.findById(walk.id).lean()
    expect(stored?.recordings[0].transcription.status).toBe('queued')
  })
})

describe('a queue that is down', () => {
  it('fails a finished walk with a reason when its recording cannot be queued, and Retry runs it', async () => {
    await seed()
    const walk = await startWalk()
    const down = vi.spyOn(transcriptionQueue, 'add').mockRejectedValue(new Error('redis down'))
    await upload(walk.id, 1)
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    down.mockRestore()

    const failed = (await api.get(`${base}/${walk.id}`)).body
    expect(failed).toMatchObject({ status: 'failed', recordings: [{ transcription: 'failed' }] })
    expect(failed.error).toContain('could not be queued')

    await api.post(`${base}/${walk.id}/retry`)
    expect((await reaches(walk.id, 'ready')).status).toBe('ready')
  })

  it('fails a typed walk with a reason when its proposal cannot be queued, and Retry runs it', async () => {
    await seed()
    const walk = await startWalk()
    await api.put(`${base}/${walk.id}/text`).send({ text: 'Block A, pallets.' })
    rag.mockImplementation(typedProposal)
    const down = vi.spyOn(proposalQueue, 'add').mockRejectedValue(new Error('redis down'))
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    down.mockRestore()

    const failed = (await api.get(`${base}/${walk.id}`)).body
    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('could not be queued')

    await api.post(`${base}/${walk.id}/retry`)
    await reaches(walk.id, 'ready')
  })

  it('queues work left over from a restart again', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    await drainInlineJobs()
    await SiteWalkModel.updateOne(
      { _id: walk.id },
      { status: 'transcribing', 'recordings.0.transcription.status': 'queued' },
    )
    const other = await SiteWalkModel.create({
      assessment: (await AssessmentModel.findOne())!._id,
      engineerId: actor._id,
      status: 'proposing',
      typedText: 'Block A.',
      metadata: {
        source_type: 'site_walk',
        jurisdiction: 'SG',
        facility_type: 'W',
        effective_date: new Date(),
      },
    })

    rag.mockImplementation((body) =>
      body.transcript.kind === 'typed' ? typedProposal() : json(200, proposalFromRag()),
    )
    await resumeInterruptedSiteWalks()
    await drainInlineJobs()

    expect((await reaches(walk.id, 'ready')).status).toBe('ready')
    expect((await reaches(String(other._id), 'ready')).status).toBe('ready')
  })

  it('sends the ready notification a crash cut off, once however often it restarts', async () => {
    const walk = await readyWalk()
    // As if the gateway stopped between saving `ready` and notifying.
    await NotificationModel.deleteMany({})
    await SiteWalkModel.collection.updateOne(
      { _id: new Types.ObjectId(walk.id) },
      { $set: { notified: false } },
    )

    await resumeInterruptedSiteWalks()
    await drainInlineJobs()
    // A crash after the notification but before the walk recorded it.
    await SiteWalkModel.collection.updateOne(
      { _id: new Types.ObjectId(walk.id) },
      { $set: { notified: false } },
    )
    await resumeInterruptedSiteWalks()
    await drainInlineJobs()

    const notes = await NotificationModel.find({ purpose: 'site_walk_ready' }).lean()
    expect(notes).toHaveLength(1)
    expect(notes[0].context).toMatchObject({ reference: REF, walkId: walk.id })
  })
})

describe('telling the engineer (F-10)', () => {
  const admin = {
    ...actor,
    _id: new Types.ObjectId(),
    staffId: 'TEST-9',
    name: 'Sana Patel',
    email: 'sana@example.com',
    role: 'knowledge_admin' as const,
  }
  const notes = (purpose: 'site_walk_ready' | 'site_walk_failed') =>
    NotificationModel.find({ purpose }).sort({ _id: 1 }).lean()

  it('tells the assessment’s current engineer, by their current role, not the walk’s own engineer', async () => {
    await seed()
    await UserModel.create(admin)
    await AssessmentModel.updateOne({ reference: REF }, { reportDueDate: new Date('2026-10-19') })
    const walk = await startWalk()
    await upload(walk.id, 1)
    // The admin takes the assessment over while the walk is being read.
    rag.mockImplementation(async () => {
      await AssessmentModel.updateOne({ reference: REF }, { engineer: admin._id })
      return json(200, proposalFromRag())
    })

    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')

    const [note] = await notes('site_walk_ready')
    expect(note).toMatchObject({
      kind: 'inbox',
      targetRole: 'knowledge_admin',
      targetUserIds: [String(admin._id)],
      context: { reportDue: '2026-10-19' },
    })
    // And the admin sees it in their Inbox.
    const inbox = await signedInAs(app, admin).get('/api/notifications?kind=inbox')
    expect(inbox.body.items.map((i: { message: string }) => i.message)).toEqual([
      'Review site walk: Tilbury DC',
    ])
  })

  it('tells them when the reading fails, and again when a retry fails again', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    setInlineAttempts(2)
    rag.mockImplementation(() => json(502, { detail: 'The reading service is down.' }))

    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'failed')
    await drainInlineJobs()

    const [first] = await notes('site_walk_failed')
    expect(first).toMatchObject({
      kind: 'inbox',
      targetRole: 'risk_engineer',
      targetUserIds: [String(actor._id)],
      message: 'Retry site walk: Tilbury DC',
      details: 'The reading service is down.',
      context: { reference: REF, walkId: walk.id, site: 'Tilbury DC' },
    })

    await api.post(`${base}/${walk.id}/retry`)
    await reaches(walk.id, 'failed')
    await drainInlineJobs()
    expect(await notes('site_walk_failed')).toHaveLength(2)
  })

  it('tells them when a recording cannot be transcribed and the walk fails', async () => {
    await seed()
    const walk = await startWalk()
    setInlineAttempts(2)
    speech.mockImplementation(() => json(503, { detail: 'Busy.' }))

    await upload(walk.id, 1)
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'failed')

    expect(await notes('site_walk_failed')).toHaveLength(1)
  })

  it('does not tell them of the failure again when the retry succeeds', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    setInlineAttempts(2)
    rag.mockImplementation(() => json(502, { detail: 'Down.' }))
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'failed')

    rag.mockImplementation(() => json(200, proposalFromRag()))
    await api.post(`${base}/${walk.id}/retry`)
    await reaches(walk.id, 'ready')

    expect(await notes('site_walk_failed')).toHaveLength(1)
    expect(await notes('site_walk_ready')).toHaveLength(1)
  })
})

describe('saving the proposal', () => {
  const edited = (patch: (p: Draft) => void) => {
    const p: Draft = {
      locations: [
        {
          ref: 'loc-1',
          existingId: null,
          kind: 'building',
          building: 'Block A',
          floor: 'L1',
          name: 'Loading bay',
        },
      ],
      observations: [
        {
          ref: 'obs-1',
          note: 'Pallets.',
          copeDimension: 'Protection',
          severity: 'high',
          locationRef: 'loc-1',
          recordingSeq: 1,
          start: 0,
          end: 5,
          photoIds: [PHOTO],
          check: { severity: false, category: false, location: false },
        },
      ],
    }
    patch(p)
    return p
  }

  it('replaces the proposal whole and spells the level the standard way', async () => {
    const walk = await readyWalk()

    const saved = await api.put(`${base}/${walk.id}/proposal`).send(
      edited((p) => {
        p.locations.push({
          ref: 'loc-2',
          existingId: String(BLOCK_A_BAY),
          kind: 'building',
          building: 'Block B',
          floor: null,
          name: 'Bay 3',
        })
        p.observations.push({
          ...p.observations[0],
          ref: 'obs-2',
          locationRef: null,
          severity: null,
          photoIds: [],
        })
      }),
    )

    expect(saved.status).toBe(200)
    expect(saved.body.proposal.locations[0].floor).toBe('Level 1')
    expect(saved.body.proposal.observations).toHaveLength(2)
    expect((await api.get(`${base}/${walk.id}`)).body.proposal).toEqual(saved.body.proposal)
  })

  it('accepts a linked location saved before the building rule, with a level and no building', async () => {
    const walk = await readyWalk()

    const saved = await api.put(`${base}/${walk.id}/proposal`).send(
      edited((p) => {
        p.locations[0] = {
          ...p.locations[0],
          existingId: String(BLOCK_A_BAY),
          kind: 'building',
          building: null,
          floor: 'Basement 2',
          name: 'Car park',
        }
      }),
    )

    expect(saved.status).toBe(200)
  })

  it.each([
    ['repeated refs', (p: Draft) => p.locations.push({ ...p.locations[0] }), /appears twice/],
    [
      'an observation at an unknown location ref',
      (p: Draft) => (p.observations[0].locationRef = 'loc-9'),
      /not in the proposal/,
    ],
    [
      'an unknown photo',
      (p: Draft) => (p.observations[0].photoIds = ['nope']),
      /photo that is not part/,
    ],
    [
      'an existing location of another assessment',
      (p: Draft) => (p.locations[0].existingId = String(new Types.ObjectId())),
      /not a location of this assessment/,
    ],
    [
      'an elsewhere location with a building',
      (p: Draft) => (p.locations[0].kind = 'elsewhere'),
      /no building or level/,
    ],
    [
      'a level with no building',
      (p: Draft) => ((p.locations[0].kind = 'building'), (p.locations[0].building = null)),
      /name it/,
    ],
    ['an unknown severity', (p: Draft) => (p.observations[0].severity = 'urgent'), /severity/],
    ['an unknown recording', (p: Draft) => (p.observations[0].recordingSeq = 7), /recording 7/],
  ])('refuses %s', async (_name, patch, message) => {
    const walk = await readyWalk()

    const response = await api.put(`${base}/${walk.id}/proposal`).send(edited(patch))

    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(message)
    expect((await api.get(`${base}/${walk.id}`)).body.proposal.locations[0].ref).toBe('loc-1')
  })

  it('accepts an observation with no note yet, and locks the proposal once Create all has started', async () => {
    const walk = await readyWalk()

    const blank = await api
      .put(`${base}/${walk.id}/proposal`)
      .send(edited((p) => void (p.observations[0].note = '')))
    expect(blank.status).toBe(200)
    expect(blank.body.proposal.observations[0].note).toBe('')

    await SiteWalkModel.updateOne(
      { _id: walk.id },
      { $set: { created: { observationIds: {}, locationIds: {} } } },
    )
    const locked = await api.put(`${base}/${walk.id}/proposal`).send(edited(() => {}))
    expect(locked.status).toBe(409)
    expect(locked.body.error).toContain('Create all has started')
  })

  it('accepts a proposal of 500 observations with the longest notes, past the global body limit', async () => {
    const walk = await readyWalk()
    const full = edited((p) => {
      p.observations = Array.from({ length: 500 }, (_, i) => ({
        ...p.observations[0],
        ref: `obs-${i + 1}`,
        note: 'x'.repeat(5000),
      }))
    })

    const saved = await api.put(`${base}/${walk.id}/proposal`).send(full)

    expect(saved.status).toBe(200)
    expect(saved.body.proposal.observations).toHaveLength(500)
  })

  it('keeps deleted observations to restore, and Create all leaves them out (round 5)', async () => {
    const walk = await readyWalk()
    const draft = edited((p) => {
      p.observations.push({ ...p.observations[0], ref: 'obs-2', note: 'Deleted one.' })
    })
    const [kept, deleted] = draft.observations
    const saved = await api
      .put(`${base}/${walk.id}/proposal`)
      .send({ ...draft, observations: [kept], removed: [deleted] })

    expect(saved.status).toBe(200)
    expect(saved.body.proposal.removed.map((o: { ref: string }) => o.ref)).toEqual(['obs-2'])
    const created = await api.post(`${base}/${walk.id}/create`)
    expect(created.body.observationIds).toHaveLength(1)
    expect(await ObservationModel.countDocuments({ note: 'Deleted one.' })).toBe(0)
  })

  it('refuses a save once the walk is not ready', async () => {
    await seed()
    const walk = await startWalk()
    expect((await api.put(`${base}/${walk.id}/proposal`).send(edited(() => {}))).status).toBe(409)
  })
})

describe('Create all', () => {
  it('adds the new locations and observations once, with the clip and photos as evidence', async () => {
    const walk = await readyWalk()
    await CaptureSessionModel.deleteMany({})

    const first = await api.post(`${base}/${walk.id}/create`)
    const again = await api.post(`${base}/${walk.id}/create`)

    expect(first.status).toBe(200)
    expect(first.body.locationIds).toHaveLength(1)
    expect(first.body.observationIds).toHaveLength(1)
    expect(again.body).toEqual(first.body)
    const assessment = await AssessmentModel.findOne({ reference: REF }).lean()
    expect(assessment!.locations.map((l) => l.name)).toEqual(['Bay 3', 'Loading bay'])
    expect(assessment!.locations[1]).toMatchObject({ building: 'Block A', floor: 'Level 1' })
    expect(await ObservationModel.countDocuments()).toBe(1)
    const o = (await ObservationModel.findById(first.body.observationIds[0]).lean())!
    expect(String(o.location)).toBe(first.body.locationIds[0])
    expect(o).toMatchObject({
      note: 'Pallets block the fire lane.',
      severity: 'high',
      engineerId: actor._id,
    })
    expect(o.metadata).toMatchObject({
      source_type: 'observation',
      COPE_dimension: ['Protection'],
      jurisdiction: 'SG',
    })
    expect(o.recordings).toHaveLength(1)
    expect(o.recordings[0]).toMatchObject({
      key: expect.stringContaining(`site-walks/${walk.id}/1.webm`),
      clip: { start: 0, end: 5 },
      transcription: {
        status: 'transcribed',
        transcript: 'We are at Block A, pallets in the fire lane.',
      },
    })
    expect(o.photos).toHaveLength(1)
    expect(s3.get(o.photos![0].key)).toEqual(JPG)
    expect(o.photos![0].key).not.toContain('site-walks')
    expect((await api.get(`${base}/${walk.id}`)).body.status).toBe('created')
    expect((await api.get(base)).body.map((w: { status: string }) => w.status)).toEqual(['created'])
    expect((await api.delete(`${base}/${walk.id}`)).status).toBe(409)
  })

  it('serves the clip through the observation with its media fragment bounds', async () => {
    const walk = await readyWalk()
    const { body } = await api.post(`${base}/${walk.id}/create`)

    const listed = await api.get(`/api/assessments/${REF}/observations`)

    expect(listed.body[0].id).toBe(body.observationIds[0])
    expect(listed.body[0].recordings[0].clip).toEqual({ siteWalk: walk.id, start: 0, end: 5 })
    // Marked as from a site walk, so the tab can tell it came from a proposal.
    expect(listed.body[0].fromSiteWalk).toBe(true)
    const stored = await ObservationModel.findById(body.observationIds[0]).lean()
    expect(String(stored!.siteWalk)).toBe(walk.id)
  })

  it('matches a new location already on the list instead of adding it twice', async () => {
    const walk = await readyWalk()
    await AssessmentModel.updateOne(
      { reference: REF },
      {
        $push: {
          locations: {
            name: 'Loading bay',
            building: 'Block A',
            floor: 'Level 1',
            key: 'loading bay|level 1|block a',
          },
        },
      },
    )

    const { body } = await api.post(`${base}/${walk.id}/create`)

    expect((await AssessmentModel.findOne({ reference: REF }).lean())!.locations).toHaveLength(2)
    expect(body.locationIds).toHaveLength(1)
  })

  it('keeps a retry on the location the first attempt created, even if it was renamed meanwhile', async () => {
    const walk = await readyWalk()
    const first = await api.post(`${base}/${walk.id}/create`)
    const storedId = first.body.locationIds[0]
    // Mimic a partial failure: the location is stored, the observation is not.
    await ObservationModel.deleteMany({})
    await SiteWalkModel.updateOne({ _id: walk.id }, { $set: { status: 'ready' } })
    await AssessmentModel.updateOne(
      { reference: REF, 'locations._id': storedId },
      {
        $set: {
          'locations.$.name': 'Renamed bay',
          'locations.$.key': 'renamed bay|level 1|block a',
        },
      },
    )

    const retry = await api.post(`${base}/${walk.id}/create`)

    expect(retry.status).toBe(200)
    expect(retry.body.locationIds).toEqual([storedId])
    const locations = (await AssessmentModel.findOne({ reference: REF }).lean())!.locations
    expect(locations.filter((l) => l.name === 'Loading bay')).toHaveLength(0)
    expect(locations).toHaveLength(2)
    const observations = await ObservationModel.find().lean()
    expect(observations.map((o) => String(o.location))).toEqual([storedId])
  })

  it('names every observation lacking a location or severity and creates nothing', async () => {
    const walk = await readyWalk()
    await api.put(`${base}/${walk.id}/proposal`).send({
      locations: [],
      observations: [
        {
          ref: 'obs-1',
          note: 'Pallets in the lane.',
          copeDimension: null,
          severity: 'high',
          locationRef: null,
          recordingSeq: null,
          start: null,
          end: null,
          photoIds: [],
          check: { severity: false, category: false, location: true },
        },
        {
          ref: 'obs-2',
          note: 'Hose reel missing.',
          copeDimension: null,
          severity: null,
          locationRef: null,
          recordingSeq: null,
          start: null,
          end: null,
          photoIds: [],
          check: { severity: true, category: false, location: true },
        },
      ],
    })

    const response = await api.post(`${base}/${walk.id}/create`)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain(
      'need a location: "Pallets in the lane.", "Hose reel missing."',
    )
    expect(response.body.error).toContain('need a severity: "Hose reel missing."')
    expect(await ObservationModel.countDocuments()).toBe(0)
    expect((await api.get(`${base}/${walk.id}`)).body.status).toBe('ready')
  })

  it('refuses to create while an observation has no note', async () => {
    const walk = await readyWalk()
    const blank = { ...(walk.proposal.observations[0] as object), note: '  ' }
    await api
      .put(`${base}/${walk.id}/proposal`)
      .send({ locations: walk.proposal.locations, observations: [blank] })

    const response = await api.post(`${base}/${walk.id}/create`)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('need a note: "obs-1"')
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('refuses a location removed from the assessment since, naming it, and keeps the proposal editable', async () => {
    const walk = await readyWalk()
    const atBay = { ...walk.proposal.observations[0], locationRef: 'loc-1' }
    const bay3 = {
      ref: 'loc-1',
      existingId: String(BLOCK_A_BAY),
      kind: 'building',
      building: 'Block B',
      floor: null,
      name: 'Bay 3',
    }
    await api.put(`${base}/${walk.id}/proposal`).send({ locations: [bay3], observations: [atBay] })
    await AssessmentModel.updateOne(
      { reference: REF },
      { $pull: { locations: { _id: BLOCK_A_BAY } } },
    )

    const response = await api.post(`${base}/${walk.id}/create`)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Bay 3')
    expect(await ObservationModel.countDocuments()).toBe(0)
    const edit = await api
      .put(`${base}/${walk.id}/proposal`)
      .send({ locations: [], observations: [] })
    expect(edit.status).toBe(200)
  })

  it('unlocks the walk when a removed location is found after ids were planned but nothing was created', async () => {
    const walk = await readyWalk()
    const atBay = { ...walk.proposal.observations[0], locationRef: 'loc-1' }
    const bay3 = {
      ref: 'loc-1',
      existingId: String(BLOCK_A_BAY),
      kind: 'building',
      building: 'Block B',
      floor: null,
      name: 'Bay 3',
    }
    await api.put(`${base}/${walk.id}/proposal`).send({ locations: [bay3], observations: [atBay] })
    // A first Create all planned the ids, then failed before inserting anything.
    await SiteWalkModel.updateOne(
      { _id: walk.id },
      { $set: { created: { observationIds: { 'obs-1': new Types.ObjectId() }, locationIds: {} } } },
    )
    await AssessmentModel.updateOne(
      { reference: REF },
      { $pull: { locations: { _id: BLOCK_A_BAY } } },
    )

    const response = await api.post(`${base}/${walk.id}/create`)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Bay 3')
    const edit = await api
      .put(`${base}/${walk.id}/proposal`)
      .send({ locations: [], observations: [] })
    expect(edit.status).toBe(200)
  })

  it('creates from the proposal as it was when Create all locked it, not an earlier read', async () => {
    const walk = await readyWalk()
    const first = walk.proposal.observations[0]
    const second = { ...first, ref: 'obs-2', note: 'Hose reel missing.', photoIds: [] }
    // A proposal save that lands just before Create all locks the proposal.
    beforeWrite(
      (update) => Boolean(update.$set?.created),
      () =>
        SiteWalkModel.collection.updateOne(
          { _id: new Types.ObjectId(walk.id) },
          { $set: { 'proposal.observations': [first, second] } },
        ),
    )

    const response = await api.post(`${base}/${walk.id}/create`)

    expect(response.status).toBe(200)
    expect(response.body.observationIds).toHaveLength(2)
    expect(response.body.observationIds.every((id: string) => Types.ObjectId.isValid(id))).toBe(
      true,
    )
    expect(await ObservationModel.countDocuments()).toBe(2)
    expect((await api.post(`${base}/${walk.id}/create`)).body).toEqual(response.body)
  })

  it('finishes a Create all that stopped half way, even after its capture session ended', async () => {
    const walk = await readyWalk()
    await CaptureSessionModel.deleteMany({})
    const first = await api.post(`${base}/${walk.id}/create`)
    // As if the gateway stopped before step e, then the session was ended.
    await SiteWalkModel.updateOne({ _id: walk.id }, { status: 'ready' })
    await CaptureSessionModel.updateMany({}, { status: 'ready_for_generation' })

    const again = await api.post(`${base}/${walk.id}/create`)

    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(await ObservationModel.countDocuments()).toBe(1)
  })

  it('is refused before the proposal is ready', async () => {
    await seed()
    const walk = await startWalk()
    expect((await api.post(`${base}/${walk.id}/create`)).status).toBe(409)
  })
})

describe('voice notes on the transcription queue', () => {
  async function voiceNote() {
    await seed()
    await CaptureSessionModel.create({
      assessment: (await AssessmentModel.findOne())!._id,
      status: 'active',
    })
    const { body } = await api
      .post(`/api/assessments/${REF}/observations`)
      .field(
        'details',
        JSON.stringify({
          copeDimensions: ['Protection'],
          severity: 'high',
          locationId: String(BLOCK_A_BAY),
        }),
      )
      .attach('recording', AUDIO, { filename: 'v.webm', contentType: 'audio/webm' })
    await drainInlineJobs()
    return (await ObservationModel.findById(body.id).lean())!.recordings[0].transcription
  }

  it('retries a busy speech service until it answers, not marking the recording failed', async () => {
    setInlineAttempts(3)
    speech
      .mockImplementationOnce(() => json(503, { detail: 'Busy.' }))
      .mockImplementation(() => heard('Valve shut.'))

    const transcription = await voiceNote()

    expect(speech).toHaveBeenCalledTimes(2)
    expect(transcription).toMatchObject({ status: 'transcribed', transcript: 'Valve shut.' })
  })

  it('marks the recording failed with the reason once the attempts run out', async () => {
    setInlineAttempts(2)
    speech.mockImplementation(() => json(503, { detail: 'Busy.' }))

    const transcription = await voiceNote()

    expect(speech).toHaveBeenCalledTimes(2)
    expect(transcription).toMatchObject({ status: 'failed', error: 'Busy.' })
  })

  it('does not retry a request the speech service refused', async () => {
    setInlineAttempts(3)
    speech.mockImplementation(() => json(400, { detail: 'Bad audio.' }))

    const transcription = await voiceNote()

    expect(speech).toHaveBeenCalledTimes(1)
    expect(transcription.status).toBe('failed')
  })
})

const note = (id: string, seq: number, text: string) =>
  api.put(`${base}/${id}/notes/${seq}`).send({ text })

describe('typed notes beside recordings', () => {
  it('saves, replaces and removes a note, listing notes by seq', async () => {
    await seed()
    const walk = await startWalk()

    await note(walk.id, 3, 'Third.')
    const second = await note(walk.id, 2, '  Second.  ')
    const replaced = await note(walk.id, 3, 'Third again.')
    const removed = await note(walk.id, 2, '   ')

    expect(second.status).toBe(200)
    expect(second.body.notes).toEqual([
      { seq: 2, text: 'Second.' },
      { seq: 3, text: 'Third.' },
    ])
    expect(replaced.body.notes).toEqual([
      { seq: 2, text: 'Second.' },
      { seq: 3, text: 'Third again.' },
    ])
    expect(removed.body.notes).toEqual([{ seq: 3, text: 'Third again.' }])
    expect((await api.put(`${base}/${walk.id}/notes/1`).send({})).status).toBe(400)
  })

  it('refuses a note once the walk is finished, and from another engineer', async () => {
    await seed()
    const walk = await startWalk()
    await note(walk.id, 1, 'Block A.')
    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    expect((await note(walk.id, 2, 'Late.')).status).toBe(409)
    expect((await note(walk.id, 1, '')).status).toBe(409)

    const other = signedInAsRole(app, 'risk_engineer')
    expect((await other.put(`${base}/${walk.id}/notes/3`).send({ text: 'x' })).status).toBe(403)
  })

  it('keeps a seq to one kind: a note and a recording cannot share it', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    await note(walk.id, 2, 'Note two.')

    const clash = await note(walk.id, 1, 'Same seq as the recording.')
    const taken = await upload(walk.id, 2)

    expect(clash.status).toBe(409)
    expect(taken.status).toBe(409)
    const stored = await SiteWalkModel.findById(walk.id).lean()
    expect(stored?.recordings.map((r) => r.seq)).toEqual([1])
    expect(stored?.notes).toEqual([{ seq: 2, text: 'Note two.' }])
    expect(s3.size).toBe(1)
  })

  it('goes straight to proposing a walk of notes alone', async () => {
    await seed()
    const walk = await startWalk()
    await note(walk.id, 1, 'Block A, pallets in the fire lane.')
    rag.mockImplementation(typedProposal)

    const finished = await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')

    expect(finished.status).toBe(200)
    expect(finished.body.status).toBe('proposing')
    expect(speech).not.toHaveBeenCalled()
    expect(rag.mock.calls[0][0].transcript).toEqual({
      kind: 'recordings',
      recordings: [{ seq: 1, kind: 'typed', text: 'Block A, pallets in the fire lane.' }],
    })
  })

  it('finishes a walk with recordings and notes together, sending them in seq order', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 3)
    await note(walk.id, 2, 'Note between.')
    await upload(walk.id, 1)
    await uploadPhoto(walk.id)
    await drainInlineJobs()

    const finished = await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')

    expect(finished.status).toBe(200)
    const sent = rag.mock.calls[0][0].transcript.recordings as Record<string, unknown>[]
    expect(sent.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(sent[1]).toEqual({ seq: 2, kind: 'typed', text: 'Note between.' })
    expect(sent[0]).toMatchObject({ seq: 1, duration_sec: 12 })
    expect((rag.mock.calls[0][0].photos as { recording_seq: number }[])[0].recording_seq).toBe(1)
  })

  it('still sends a legacy typed walk as typed text', async () => {
    await seed()
    const walk = await startWalk()
    await SiteWalkModel.updateOne({ _id: walk.id }, { typedText: 'Old typed walk.' })
    rag.mockImplementation(typedProposal)

    await api.post(`${base}/${walk.id}/finish`).send({ name: 'Tower A walk' })
    await reaches(walk.id, 'ready')

    expect(rag.mock.calls[0][0].transcript).toEqual({ kind: 'typed', text: 'Old typed walk.' })
  })

  it('exposes each recording transcript and audio url, and serves the audio in parts', async () => {
    await seed()
    const walk = await startWalk()
    const queued = await upload(walk.id, 1)
    expect(queued.body.recordings[0]).toMatchObject({ transcript: null })
    await drainInlineJobs()

    const read = (await api.get(`${base}/${walk.id}`)).body.recordings[0]
    expect(read.transcript).toBe('We are at Block A, pallets in the fire lane.')
    expect(read.audioUrl).toBe(`${base}/${walk.id}/recordings/1`)

    const part = await api.get(read.audioUrl).set('Range', 'bytes=2-5').buffer(true)
    expect(part.status).toBe(206)
    expect(part.body).toEqual(AUDIO.subarray(2, 6))
    expect((await api.get(`${base}/${walk.id}/recordings/9`)).status).toBe(404)
  })
})

// Round 3 (2 Nov): the proposal's Add observation reuses the main capture
// screen, so a hand-added observation brings its own photos, handwritten pages
// and voice clips. They are stored with the walk and created on Create all.
describe('media added to the proposal by hand', () => {
  const VOICE = '22222222-2222-4222-8222-222222222222'
  const SNAP = '33333333-3333-4333-8333-333333333333'
  const PAGE = '44444444-4444-4444-8444-444444444444'
  const handwriting = vi.fn<(body: { s3_key: string }) => Promise<Response>>()
  beforeEach(() => {
    handwriting.mockImplementation(() =>
      json(200, { transcript: 'Hose reel 3 missing.', uncertain: [], usage: [] }),
    )
    const stubbed = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
      url.endsWith('/transcribe-handwriting')
        ? handwriting(JSON.parse(String(init.body)))
        : stubbed(url, init),
    )
  })

  const addMedia = (id: string, mediaId: string, part: 'recording' | 'photo' | 'page') =>
    api
      .put(`${base}/${id}/media/${mediaId}`)
      .attach(
        part,
        part === 'recording' ? AUDIO : JPG,
        part === 'recording'
          ? { filename: 'v.webm', contentType: 'audio/webm' }
          : { filename: 'p.jpg', contentType: 'image/jpeg' },
      )

  // The walk's proposal plus one observation added by hand with its media.
  const withAdded = (walk: { proposal: Draft }, mediaIds: string[], note = '') => ({
    locations: walk.proposal.locations,
    observations: [
      ...walk.proposal.observations,
      {
        ref: 'obs-2',
        note,
        copeDimension: 'Occupancy',
        severity: 'low',
        locationRef: 'loc-1',
        recordingSeq: null,
        start: null,
        end: null,
        photoIds: [],
        mediaIds,
        check: { severity: false, category: false, location: false },
      },
    ],
  })

  it('stores each item once per client id and transcribes a voice clip in the background', async () => {
    const walk = await readyWalk()
    speech.mockImplementation(() => heard('Hose reel three is missing.'))

    expect((await addMedia(walk.id, VOICE, 'recording')).status).toBe(200)
    expect((await addMedia(walk.id, VOICE, 'recording')).status).toBe(200)
    await addMedia(walk.id, SNAP, 'photo')
    await addMedia(walk.id, PAGE, 'page')
    await drainInlineJobs()

    const read = (await api.get(`${base}/${walk.id}`)).body
    expect(read.media).toEqual([
      {
        id: VOICE,
        kind: 'voice',
        url: `${base}/${walk.id}/media/${VOICE}`,
        transcription: 'transcribed',
        transcript: 'Hose reel three is missing.',
      },
      {
        id: SNAP,
        kind: 'photo',
        url: `${base}/${walk.id}/media/${SNAP}`,
        transcription: null,
        transcript: null,
      },
      {
        id: PAGE,
        kind: 'page',
        url: `${base}/${walk.id}/media/${PAGE}`,
        transcription: null,
        transcript: null,
      },
    ])
    // The walk's own photos are untouched; only the recording and the voice clip were transcribed.
    expect(read.photos).toHaveLength(1)
    expect(speech).toHaveBeenCalledTimes(2)
    expect((await api.get(`${base}/${walk.id}/media/${SNAP}`)).body).toEqual(JPG)
  })

  it('refuses a file of the wrong kind, and media while the walk is still recording', async () => {
    const ready = await readyWalk()
    const text = await api
      .put(`${base}/${ready.id}/media/${SNAP}`)
      .attach('photo', Buffer.from('not an image'), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })
    expect(text.status).toBe(415)

    const recording = await startWalk()
    expect((await addMedia(recording.id, SNAP, 'photo')).status).toBe(409)
  })

  it('saves an observation that points at its media, and refuses media the walk does not have', async () => {
    const walk = await readyWalk()
    await addMedia(walk.id, SNAP, 'photo')

    const saved = await api.put(`${base}/${walk.id}/proposal`).send(withAdded(walk, [SNAP]))
    expect(saved.status).toBe(200)
    expect(saved.body.proposal.observations[1].mediaIds).toEqual([SNAP])

    const unknown = await api.put(`${base}/${walk.id}/proposal`).send(withAdded(walk, [PAGE]))
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toContain('obs-2 has media that is not part of this walk')
  })

  it('creates the added observation once with its voice clip, photo and page, needing no note', async () => {
    const walk = await readyWalk()
    speech.mockImplementation(() => heard('Hose reel three is missing.'))
    for (const [id, part] of [
      [VOICE, 'recording'],
      [SNAP, 'photo'],
      [PAGE, 'page'],
    ] as const)
      await addMedia(walk.id, id, part)
    await drainInlineJobs()
    await api.put(`${base}/${walk.id}/proposal`).send(withAdded(walk, [VOICE, SNAP, PAGE]))

    const first = await api.post(`${base}/${walk.id}/create`)
    const again = await api.post(`${base}/${walk.id}/create`)
    await vi.waitFor(async () =>
      expect(
        (await ObservationModel.findById(first.body.observationIds[1]).lean())!.pages![0]
          .transcription.status,
      ).toBe('transcribed'),
    )

    expect(first.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(await ObservationModel.countDocuments()).toBe(2)
    const o = (await ObservationModel.findById(first.body.observationIds[1]).lean())!
    expect(o.note).toBeUndefined()
    expect(o.metadata).toMatchObject({ source_type: 'observation', COPE_dimension: ['Occupancy'] })
    expect(o.recordings).toHaveLength(1)
    expect(o.recordings[0]).toMatchObject({
      key: expect.stringContaining(`site-walks/${walk.id}/media/${VOICE}`),
      transcription: { status: 'transcribed', transcript: 'Hose reel three is missing.' },
    })
    expect(o.recordings[0].clip).toBeUndefined()
    expect(o.photos).toHaveLength(1)
    expect(s3.get(o.photos![0].key)).toEqual(JPG)
    expect(o.pages![0].transcription).toMatchObject({
      status: 'transcribed',
      transcript: 'Hose reel 3 missing.',
    })
    expect(handwriting).toHaveBeenCalledTimes(1)
  })

  it('transcribes a voice clip on the observation when Create all runs before its walk transcript', async () => {
    const walk = await readyWalk()
    setInlineAttempts(1)
    speech.mockImplementationOnce(() => json(400, { detail: 'Bad audio.' }))
    await addMedia(walk.id, VOICE, 'recording')
    await drainInlineJobs()
    expect((await api.get(`${base}/${walk.id}`)).body.media[0].transcription).toBe('failed')
    await api.put(`${base}/${walk.id}/proposal`).send(withAdded(walk, [VOICE], 'Hose reel.'))
    speech.mockImplementation(() => heard('Hose reel three is missing.'))

    const { body } = await api.post(`${base}/${walk.id}/create`)
    await drainInlineJobs()

    const o = (await ObservationModel.findById(body.observationIds[1]).lean())!
    expect(o.recordings[0].transcription).toMatchObject({
      status: 'transcribed',
      transcript: 'Hose reel three is missing.',
    })
  })
})

// Photos and recordings of every format: what is stored, and what is refused
// (Sprint 4 fixes, CP-22).
describe('accepted formats', () => {
  const blank = (w = 40, h = 20) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } })
  const putPhoto = (id: string, bytes: Buffer, name = 'p.jpg') =>
    api
      .put(`${base}/${id}/photos/${PHOTO}`)
      .attach('photo', bytes, { filename: name, contentType: 'image/jpeg' })
  const putRecording = (id: string, bytes: Buffer, durationSec = '0', name = 'r.mp3') =>
    api
      .put(`${base}/${id}/recordings/1`)
      .field('durationSec', durationSec)
      .attach('recording', bytes, { filename: name, contentType: 'audio/mpeg' })
  const stored = async (id: string) => (await SiteWalkModel.findById(id).lean())!
  const storedBytes = () => [...s3.values()]

  async function walkId() {
    await seed()
    return (await startWalk()).id as string
  }

  it.each([
    ['WebP', () => blank().webp().toBuffer()],
    ['GIF', () => blank().gif().toBuffer()],
    ['TIFF', () => blank().tiff().toBuffer()],
    ['AVIF', () => blank().avif().toBuffer()],
    ['HEIC', async () => readFileSync(`${__dirname}/fixtures/tiny.heic`)],
    ['BMP', async () => bmpImage()],
  ])('stores a %s photo as a JPEG', async (_name, make) => {
    const id = await walkId()

    const res = await putPhoto(id, await make(), 'photo.heic')

    expect(res.status).toBe(200)
    const [photo] = (await stored(id)).photos
    expect(photo).toMatchObject({ contentType: 'image/jpeg' })
    expect(photo.key.endsWith('.jpg')).toBe(true)
    expect((await sharp(s3.get(photo.key)).metadata()).format).toBe('jpeg')
  })

  it('applies the EXIF rotation to a converted photo', async () => {
    const id = await walkId()
    const webp = await blank(40, 20).webp().withMetadata({ orientation: 6 }).toBuffer()

    await putPhoto(id, webp)

    const [photo] = (await stored(id)).photos
    const { width, height, orientation } = await sharp(s3.get(photo.key)).metadata()
    expect([width, height, orientation]).toEqual([20, 40, undefined])
  })

  it('stores a JPG and a PNG byte for byte', async () => {
    const id = await walkId()
    const png = await blank().png().toBuffer()

    await putPhoto(id, JPG)
    await api
      .put(`${base}/${id}/photos/22222222-2222-4222-8222-222222222222`)
      .attach('photo', png, { filename: 'p.png', contentType: 'image/png' })

    expect(storedBytes().some((b) => b.equals(JPG))).toBe(true)
    expect(storedBytes().some((b) => b.equals(png))).toBe(true)
  })

  it.each([
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>')],
    ['a PDF', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')],
    ['a text file renamed .jpg', Buffer.from('just some words')],
    ['a damaged WebP', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 junk', 'latin1')],
  ])('refuses %s and stores nothing', async (_name, bytes) => {
    const id = await walkId()

    const res = await putPhoto(id, bytes)

    expect(res.status).toBe(415)
    expect(res.body).toMatchObject({ code: 'wrong_type' })
    expect((await stored(id)).photos).toEqual([])
    expect(s3.size).toBe(0)
  })

  it('refuses a photo over 20 MB with too_large', async () => {
    const id = await walkId()

    const res = await putPhoto(id, Buffer.alloc(20 * 1024 * 1024 + 1, 1))

    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ code: 'too_large' })
    expect(s3.size).toBe(0)
  })

  it.each([
    ['MP3', mp3Audio, 'mp3'],
    ['WAV', wavAudio, 'wav'],
    ['WebM', webmAudio, 'webm'],
  ])('stores %s audio unchanged and takes its length from the file', async (_n, make, ext) => {
    const id = await walkId()
    const audio = make()

    const res = await putRecording(id, audio, '0', 'x.bin')

    expect(res.status).toBe(200)
    const [recording] = (await stored(id)).recordings
    expect(recording.key.endsWith(`.${ext}`)).toBe(true)
    expect(s3.get(recording.key)!.equals(audio)).toBe(true)
    expect(recording.durationSec).toBeGreaterThan(0)
  })

  it.each([
    ['AAC', aacAudio],
    ['AIFF', aiffAudio],
  ])('converts %s to m4a', async (_n, make) => {
    const id = await walkId()
    const audio = make()

    const res = await putRecording(id, audio, '0', 'x.m4a')

    expect(res.status).toBe(200)
    const [recording] = (await stored(id)).recordings
    expect(recording).toMatchObject({ contentType: 'audio/x-m4a' })
    expect(recording.key.endsWith('.m4a')).toBe(true)
    expect(s3.get(recording.key)!.equals(audio)).toBe(false)
  })

  it('keeps the client length when the file has none', async () => {
    const id = await walkId()
    // A live WebM from a browser has no Duration; ffmpeg's matroska muxer
    // writes none when told not to seek.
    const noLength = audioFile('webm', ['-c:a', 'libopus', '-f', 'webm'], 3)
    expect(noLength.length).toBeGreaterThan(0)

    await putRecording(id, noLength, '7')

    expect((await stored(id)).recordings[0].durationSec).toBeGreaterThanOrEqual(3)
  })

  it('refuses text renamed .mp3 and stores nothing', async () => {
    const id = await walkId()

    const res = await putRecording(id, Buffer.from('not audio at all'))

    expect(res.status).toBe(415)
    expect(res.body).toMatchObject({ code: 'wrong_type' })
    expect(s3.size).toBe(0)
  })

  it('refuses a playlist that points at other files', async () => {
    const id = await walkId()
    const playlist = Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n')
    const concat = Buffer.from("ffconcat version 1.0\nfile '/etc/passwd'\n")

    const res = await putRecording(id, playlist, '1', 'a.m3u8')
    const res2 = await putRecording(id, concat, '1', 'a.mp3')

    expect([res.status, res2.status]).toEqual([415, 415])
    expect(s3.size).toBe(0)
  })

  it('refuses a recording over 20 minutes with too_long', async () => {
    const id = await walkId()
    const long = audioFile('webm', ['-c:a', 'libopus', '-b:a', '6k'], 21 * 60)

    const res = await putRecording(id, long, '10', 'long.webm')

    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ code: 'too_long' })
    expect(s3.size).toBe(0)
  }, 30_000)

  // 25 minutes of silence, made once per file (low bitrate keeps it small).
  const long = {
    mp3: undefined as Buffer | undefined,
    webm: undefined as Buffer | undefined,
  }
  const longMp3 = () =>
    (long.mp3 ??= silentAudio('mp3', ['-c:a', 'libmp3lame', '-b:a', '8k'], 25 * 60, {
      tags: ['-metadata', 'title=Duration: 00:00:01.00'],
    }))
  const longWebm = () =>
    (long.webm ??= silentAudio('webm', ['-c:a', 'libopus', '-b:a', '6k'], 25 * 60, {
      toPipe: true,
    }))

  it('refuses a 25 minute MP3 whose title tag claims one second', async () => {
    const id = await walkId()

    const res = await putRecording(id, longMp3(), '1', 'long.mp3')

    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ code: 'too_long' })
    expect(s3.size).toBe(0)
  }, 60_000)

  it('refuses a 25 minute WebM with no Duration, whatever length the client sends', async () => {
    const id = await walkId()

    const res = await putRecording(id, longWebm(), '5', 'long.webm')

    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ code: 'too_long' })
    expect(s3.size).toBe(0)
  }, 60_000)

  it('stores a short WebM with no Duration at the measured length, not the client’s', async () => {
    const id = await walkId()
    const short = silentAudio('webm', ['-c:a', 'libopus', '-b:a', '6k'], 4, { toPipe: true })

    const res = await putRecording(id, short, '500', 'short.webm')

    expect(res.status).toBe(200)
    const [recording] = (await stored(id)).recordings
    expect(recording.durationSec).toBeGreaterThanOrEqual(3)
    expect(recording.durationSec).toBeLessThanOrEqual(5)
  })

  it('stores an AVIF whose brand reads mif1 (the HEIC brand) as a JPEG', async () => {
    const id = await walkId()
    const avif = await blank().avif().toBuffer()
    avif.write('mif1', 8, 'latin1')

    const res = await putPhoto(id, avif)

    expect(res.status).toBe(200)
    const [photo] = (await stored(id)).photos
    expect(photo).toMatchObject({ contentType: 'image/jpeg' })
    expect((await sharp(s3.get(photo.key)).metadata()).format).toBe('jpeg')
  })

  it('answers 403, not 415, to an unassigned engineer sending bad bytes, and converts nothing', async () => {
    const id = await walkId()
    const other = signedInAsRole(app, 'risk_engineer', 'Someone Else')
    const photoConvert = vi.spyOn(mediaConvert, 'toStoredPhoto')
    const recordingConvert = vi.spyOn(mediaConvert, 'toStoredRecording')

    const photo = await other
      .put(`${base}/${id}/photos/${PHOTO}`)
      .attach('photo', Buffer.from('not an image'), { filename: 'p.jpg' })
    const recording = await other
      .put(`${base}/${id}/recordings/1`)
      .field('durationSec', '3')
      .attach('recording', Buffer.from('not audio'), { filename: 'r.mp3' })

    expect([photo.status, recording.status]).toEqual([403, 403])
    expect(photoConvert).not.toHaveBeenCalled()
    expect(recordingConvert).not.toHaveBeenCalled()
  })

  it('still refuses HEIC on the routes that take JPG and PNG only', async () => {
    await seed()
    await CaptureSessionModel.create({
      assessment: (await AssessmentModel.findOne())!._id,
      status: 'active',
    })

    const res = await api
      .post(`/api/assessments/${REF}/observations`)
      .field(
        'details',
        JSON.stringify({
          copeDimensions: ['Protection'],
          severity: 'high',
          locationId: String(BLOCK_A_BAY),
        }),
      )
      .attach('photo', readFileSync(`${__dirname}/fixtures/tiny.heic`), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })

    expect(res.status).toBe(415)
  })
})

// Retrying and removing recordings and photos on a walk being recorded.
describe('retrying and removing (Sprint 4 fixes)', () => {
  async function walkWith() {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    await uploadPhoto(walk.id)
    await drainInlineJobs()
    return walk.id as string
  }
  const failRecording = (id: string) =>
    SiteWalkModel.updateOne(
      { _id: id },
      {
        $set: {
          'recordings.0.transcription.status': 'failed',
          'recordings.0.transcription.error': 'x',
        },
      },
    )

  it('retries a failed recording, and a second press does nothing', async () => {
    const id = await walkWith()
    await failRecording(id)
    speech.mockClear()

    const res = await api.post(`${base}/${id}/recordings/1/retry`)
    await drainInlineJobs()
    const again = await api.post(`${base}/${id}/recordings/1/retry`)
    await drainInlineJobs()

    expect(res.status).toBe(200)
    expect(again.status).toBe(200)
    expect(speech).toHaveBeenCalledTimes(1)
    expect(again.body.recordings[0].transcription).toBe('transcribed')
  })

  it('leaves a recording that is not failed alone, and 404s an unknown one', async () => {
    const id = await walkWith()
    speech.mockClear()

    const res = await api.post(`${base}/${id}/recordings/1/retry`)
    const unknown = await api.post(`${base}/${id}/recordings/9/retry`)
    await drainInlineJobs()

    expect(res.status).toBe(200)
    expect(unknown.status).toBe(404)
    expect(speech).not.toHaveBeenCalled()
  })

  it('removes a recording with its file and unlinks its photos', async () => {
    const id = await walkWith()
    const key = (await SiteWalkModel.findById(id).lean())!.recordings[0].key

    const res = await api.delete(`${base}/${id}/recordings/1`)
    const twice = await api.delete(`${base}/${id}/recordings/1`)

    expect(res.status).toBe(200)
    expect(twice.status).toBe(200)
    expect(res.body.recordings).toEqual([])
    expect(res.body.photos).toEqual([
      expect.objectContaining({ id: PHOTO, recordingSeq: null, offsetSec: null }),
    ])
    expect(s3.has(key)).toBe(false)
  })

  it('ends a transcription of a removed recording without error or leftovers', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    await api.delete(`${base}/${walk.id}/recordings/1`)
    await drainInlineJobs()

    const after = (await SiteWalkModel.findById(walk.id).lean())!
    expect(after.recordings).toEqual([])
    expect(after.status).toBe('recording')
  })

  it('removes a photo and its file; again is fine', async () => {
    const id = await walkWith()
    const key = (await SiteWalkModel.findById(id).lean())!.photos[0].key

    const res = await api.delete(`${base}/${id}/photos/${PHOTO}`)
    const twice = await api.delete(`${base}/${id}/photos/${PHOTO}`)

    expect([res.status, twice.status]).toEqual([200, 200])
    expect(res.body.photos).toEqual([])
    expect(s3.has(key)).toBe(false)
  })

  it('refuses removing once the walk is finished, and keeps the file', async () => {
    const id = await walkWith()
    await api.post(`${base}/${id}/finish`).send({ name: 'Tower A walk' })

    const rec = await api.delete(`${base}/${id}/recordings/1`)
    const photo = await api.delete(`${base}/${id}/photos/${PHOTO}`)

    expect([rec.status, photo.status]).toEqual([409, 409])
    expect(s3.size).toBe(2)
  })

  it('leaves a removed photo and recording out of the proposal', async () => {
    const id = await walkWith()
    await upload(id, 3)
    await api.delete(`${base}/${id}/photos/${PHOTO}`)
    await api.delete(`${base}/${id}/recordings/1`)
    const proposal = proposalFromRag()
    proposal.observations[0].recording_seq = 3
    rag.mockImplementation(() => json(200, proposal))

    await api.post(`${base}/${id}/finish`).send({ name: 'Tower A walk' })
    await reaches(id, 'ready')

    const sent = rag.mock.calls[0][0]
    expect(sent.photos).toEqual([])
    expect(sent.transcript.recordings.map((r) => r.seq)).toEqual([3])
  })

  it('clears the photo links to a recording that is not on the server, and returns the walk', async () => {
    const id = await walkWith()
    // The recording never arrived (or is long gone), but the photo still points at it.
    await SiteWalkModel.updateOne({ _id: id }, { $pull: { recordings: { seq: 1 } } })

    const res = await api.delete(`${base}/${id}/recordings/1`)

    expect(res.status).toBe(200)
    expect(res.body.photos).toEqual([
      expect.objectContaining({ id: PHOTO, recordingSeq: null, offsetSec: null }),
    ])
    const [photo] = (await SiteWalkModel.findById(id).lean())!.photos
    expect([photo.recordingSeq, photo.offsetSec]).toEqual([null, null])
  })

  it('returns a finished walk for an absent recording, but still refuses a present one', async () => {
    const id = await walkWith()
    await api.post(`${base}/${id}/finish`).send({ name: 'Tower A walk' })

    const absent = await api.delete(`${base}/${id}/recordings/9`)
    const present = await api.delete(`${base}/${id}/recordings/1`)

    expect(absent.status).toBe(200)
    expect(absent.body.id).toBe(id)
    expect(present.status).toBe(409)
  })

  it('keeps a walk transcribing, and tells nobody, when its recording is removed mid-job', async () => {
    await seed()
    const walk = await startWalk()
    await upload(walk.id, 1)
    await drainInlineJobs()
    await SiteWalkModel.updateOne(
      { _id: walk.id },
      { status: 'transcribing', 'recordings.0.transcription.status': 'queued' },
    )
    // The recording is removed while the speech service is working, which then fails.
    speech.mockImplementation(async () => {
      await SiteWalkModel.updateOne({ _id: walk.id }, { $pull: { recordings: { seq: 1 } } })
      return json(500, { detail: 'Down' })
    })

    await runWalkTranscription(walk.id, 1, { isLastAttempt: true } as never)

    const after = (await SiteWalkModel.findById(walk.id).lean())!
    expect(after.status).toBe('transcribing')
    expect(await NotificationModel.countDocuments({ purpose: 'site_walk_failed' })).toBe(0)
  })
})
