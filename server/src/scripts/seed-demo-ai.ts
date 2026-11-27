// `npm run seed -- --reset --with-ai`: the demo set's AI-made content, made by the app itself.
// Every step is the request the browser sends, as Alex, so the gateway, its background jobs and
// rag-service run their own checks (privacy masking, cited statements, Ask-style line checks) and
// record their own cost on Usage and Costs; nothing here writes AI output to the database.
// Called by seed-demo.ts once the reports are built. Cost about US$1 (US$1.06 on 25 Nov 2026:
// checklists 0.84, comparison 0.11, client summaries 0.08, the rest under a cent each).
// Media is team-made or free to publish: see seed-media/CREDITS.md.
import { randomUUID } from 'node:crypto'
import type { Types } from 'mongoose'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { SiteWalkModel } from '../models/site-walk.model'
import { type Gateway, mediaFile } from './seed-demo-live'

type Built = { _id: Types.ObjectId; idOf: Map<string, string>; site: { _id: Types.ObjectId } }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Media added to saved observations (CP-08, CP-19): fixture id, then the file as a form part.
// The reading job then transcribes it or describes it (CP-24); D9 has no category or severity
// yet, so it also gets both suggested.
const OBSERVATION_MEDIA = [
  {
    ref: 'RPT-2026-0004',
    id: 'D9',
    part: 'photo',
    file: 'fire-alarm-panel.jpg',
    type: 'image/jpeg',
  },
  {
    ref: 'RPT-2026-0004',
    id: 'D4',
    part: 'page',
    file: 'pandan-dock-notes.jpg',
    type: 'image/jpeg',
  },
  {
    ref: 'RPT-2026-0004',
    id: 'D5',
    part: 'recording',
    file: 'pandan-valve-room.m4a',
    type: 'audio/mp4',
  },
  {
    ref: 'RPT-2026-0005',
    id: 'B1',
    part: 'recording',
    file: 'tuas-pump-room.m4a',
    type: 'audio/mp4',
  },
] as const

// Waits until the background jobs on these observations are done: no recording or page still
// transcribing, no photo still being described, no suggestion still being read.
async function settled(ids: string[]) {
  for (let i = 0; i < 120; i++) {
    const busy = await ObservationModel.countDocuments({
      _id: { $in: ids },
      $or: [
        { 'recordings.transcription.status': 'transcribing' },
        { 'pages.transcription.status': 'transcribing' },
        { 'interpretation.photoReading.status': 'interpreting' },
        { 'suggestion.status': 'reading' },
      ],
    })
    if (!busy) return
    await sleep(2_000)
  }
  throw new Error('The observations were still being read after 4 minutes.')
}

// 1. Adds the media to the observations and waits for them to be read.
async function addObservationMedia(alex: Gateway, built: Record<string, Built>) {
  const ids: string[] = []
  for (const m of OBSERVATION_MEDIA) {
    const id = built[m.ref].idOf.get(m.id)!
    const form = new FormData()
    form.append(m.part, await mediaFile(m.file, m.type), m.file)
    await alex.call('POST', `/observations/${id}/media`, form)
    ids.push(id)
  }
  // The jobs are queued after the answer; without this pause the check could run before them.
  await sleep(3_000)
  await settled(ids)
  const failed = await ObservationModel.countDocuments({
    _id: { $in: ids },
    $or: [
      { 'recordings.transcription.status': 'failed' },
      { 'pages.transcription.status': 'failed' },
      { 'interpretation.photoReading.status': 'failed' },
      { 'suggestion.status': 'failed' },
    ],
  })
  if (failed) throw new Error(`${failed} observation(s) could not be read. See the server log.`)
  console.log(`  read ${ids.length} observations' photo, page and recordings`)
}

// 2. Records a site walk on RPT-2026-0004 (CP-22): two recordings and a photo taken during the
// first, then Finish. Transcription and the proposal run in the background; the walk is left
// with its proposal ready to review, as the engineer would find it.
async function recordSiteWalk(alex: Gateway) {
  const base = '/assessments/RPT-2026-0004/site-walks'
  const walk = await alex.call<{ id: string }>('POST', base)
  const clips = [
    { file: 'walk-yard.m4a', seconds: 13 },
    { file: 'walk-charging-room.m4a', seconds: 10 },
  ]
  for (const [i, clip] of clips.entries()) {
    const form = new FormData()
    form.append('recording', await mediaFile(clip.file, 'audio/mp4'), clip.file)
    form.append('durationSec', String(clip.seconds))
    await alex.call('PUT', `${base}/${walk.id}/recordings/${i + 1}`, form)
  }
  const photo = new FormData()
  const photoId = randomUUID()
  photo.append('photo', await mediaFile('hot-work.jpg', 'image/jpeg'), `${photoId}.jpg`)
  photo.append('recordingSeq', '1')
  photo.append('offsetSec', '8')
  await alex.call('PUT', `${base}/${walk.id}/photos/${photoId}`, photo)
  await alex.call('POST', `${base}/${walk.id}/finish`, {
    name: 'Afternoon walk, yard and Warehouse A',
  })
  for (let i = 0; i < 120; i++) {
    const { status } = (await SiteWalkModel.findById(walk.id, 'status').lean())!
    if (status === 'ready') return console.log('  site walk proposal ready on RPT-2026-0004')
    if (status === 'failed') throw new Error('The site walk proposal failed. See the server log.')
    await sleep(2_000)
  }
  throw new Error('The site walk proposal was not ready after 4 minutes.')
}

// 3. Generates the pre-survey checklist (CP-30) of each open assessment from every standard in
// its scope, as the Checklist tab does when nothing is unticked.
async function generateChecklists(alex: Gateway) {
  for (const ref of ['RPT-2026-0004', 'RPT-2026-0005', 'RPT-2026-0006']) {
    const { standards } = await alex.call<{ standards: { id: string }[] }>(
      'GET',
      `/assessments/${ref}/checklist`,
    )
    await alex.call('POST', `/assessments/${ref}/checklist`, {
      standardIds: standards.map((s) => s.id),
    })
    console.log(`  checklist for ${ref} from ${standards.length} standards`)
  }
}

// 4. Compares the Tuas Cold Store resurvey with the previous report (RV-13).
async function compareTuas(alex: Gateway) {
  await alex.call('POST', '/assessments/RPT-2026-0005/comparison', { previous: 'RPT-2026-0001' })
  console.log('  compared RPT-2026-0005 with RPT-2026-0001')
}

// 5. Writes the Insights summary (CP-29) of each client where Alex has observations.
async function summariseClients(alex: Gateway, built: Record<string, Built>) {
  const refs = ['RPT-2026-0002', 'RPT-2026-0003', 'RPT-2026-0004', 'RPT-2026-0005']
  const sites = await SiteModel.find({ _id: { $in: refs.map((r) => built[r].site._id) } }, 'client')
  const clients = new Set(sites.map((s) => String(s.client)))
  for (const client of clients) await alex.call('POST', `/clients/${client}/insights/summary`)
  console.log(`  wrote ${clients.size} client summaries`)
}

/** Makes the demo set's AI content through the app, as Alex; returns when all of it is done. */
export async function seedAi(alex: Gateway, built: Record<string, Built>) {
  console.log('Making the AI content through the app (paid calls)...')
  await addObservationMedia(alex, built)
  await recordSiteWalk(alex)
  await generateChecklists(alex)
  // After the media: the comparison and summaries read the transcripts and descriptions too.
  await compareTuas(alex)
  await summariseClients(alex, built)
}
