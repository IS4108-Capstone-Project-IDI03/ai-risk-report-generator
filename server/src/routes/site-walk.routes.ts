// The site walk API (CP-22), mounted under /api/assessments/:reference/site-walks.
// Called by the client's site-walk feature. Calls only services: the walk
// lifecycle, its proposal and Create all. Writes need assessments:edit, reads
// assessments:view.
import { Router, type Request, type Response } from 'express'
import { NotAssignedError } from '../services/assessment.service'
import {
  AssessmentArchivedError,
  AssessmentNotFoundError,
} from '../services/capture-session.service'
import { requirePermission } from '../middleware/auth.middleware'
import { createAll } from '../services/site-walk-create.service'
import { saveProposal } from '../services/site-walk-proposal.service'
import {
  addPhoto,
  addProposalMedia,
  addRecording,
  discardWalk,
  finishWalk,
  getWalk,
  getWalkPhoto,
  getProposalMedia,
  getWalkRecording,
  InvalidSiteWalkError,
  listWalks,
  mediaIdSchema,
  noteFieldsSchema,
  photoFieldsSchema,
  recordingFieldsSchema,
  renameWalk,
  retryWalk,
  setNote,
  setText,
  SiteWalkNotFoundError,
  SiteWalkStateError,
  startWalk,
  typedTextSchema,
  walkNameSchema,
} from '../services/site-walk.service'
import { sendFile } from './byte-range'
import { fieldErrors } from './field-errors'
import { mediaParts, multipartBody, readForm, tooLarge } from './media-form'

const router = Router({ mergeParams: true })

// Answers a refused request with its status: 400 invalid, 403 not the walk's
// engineer, 404 unknown, 409 archived or in the wrong state. Rethrows anything else.
function refuse(error: unknown, res: Response) {
  const status =
    error instanceof InvalidSiteWalkError
      ? 400
      : error instanceof NotAssignedError
        ? 403
        : error instanceof SiteWalkNotFoundError || error instanceof AssessmentNotFoundError
          ? 404
          : error instanceof SiteWalkStateError || error instanceof AssessmentArchivedError
            ? 409
            : null
  if (!status || !(error instanceof Error)) throw error
  res.status(status).json({ error: error.message })
}

// Runs a handler and turns its refusals into responses.
const guarded =
  (handler: (req: Request<Record<string, string>>, res: Response) => Promise<void>) =>
  async (req: Request<Record<string, string>>, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      refuse(error, res)
    }
  }

const edit = requirePermission('assessments:edit')
const view = requirePermission('assessments:view')

// Starts this engineer's walk, or returns the one they are still recording.
router.post(
  '/',
  edit,
  guarded(async (req, res) => {
    const { created, walk } = await startWalk(req.params.reference, res.locals.user!)
    res.status(created ? 201 : 200).json(walk)
  }),
)

router.get(
  '/',
  view,
  guarded(async (req, res) => void res.json(await listWalks(req.params.reference))),
)

router.get(
  '/:walkId',
  view,
  guarded(
    async (req, res) =>
      void res.json(await getWalk(req.params.reference, req.params.walkId, res.locals.user!)),
  ),
)

// A recording of the walk: multipart `recording` file and `durationSec`.
router.put(
  '/:walkId/recordings/:seq',
  edit,
  multipartBody,
  guarded(async (req, res) => {
    const form = await readForm(req)
    const fields = recordingFieldsSchema.safeParse({
      seq: req.params.seq,
      durationSec: form?.get('durationSec'),
    })
    if (!form || !fields.success) {
      res.status(400).json({
        error: 'Send the recording as a multipart form with its durationSec.',
        ...(!fields.success && { fields: fieldErrors(fields.error) }),
      })
      return
    }
    const media = await mediaParts(form)
    if ('error' in media) {
      res.status(media.status).json({ error: media.error })
      return
    }
    if (media.recordings.length !== 1 || media.photos.length || media.pages.length) {
      res.status(400).json({ error: 'Send exactly one recording.' })
      return
    }
    res.json(
      await addRecording(
        req.params.reference,
        req.params.walkId,
        fields.data.seq,
        media.recordings[0],
        fields.data.durationSec,
        res.locals.user!,
      ),
    )
  }),
)

// A typed note of the walk, numbered with its recordings: JSON `{ text }`.
// Blank text removes the note.
router.put(
  '/:walkId/notes/:seq',
  edit,
  guarded(async (req, res) => {
    const parsed = noteFieldsSchema.safeParse({ seq: req.params.seq, text: req.body?.text })
    if (!parsed.success) {
      res.status(400).json({ error: 'The note is invalid.', fields: fieldErrors(parsed.error) })
      return
    }
    res.json(await setNote(req.params.reference, req.params.walkId, parsed.data, res.locals.user!))
  }),
)

// A recording's audio, for playback on the Recording screen (Range supported).
router.get(
  '/:walkId/recordings/:seq',
  view,
  guarded(async (req, res) => {
    const seq = recordingFieldsSchema.shape.seq.safeParse(req.params.seq)
    if (!seq.success) {
      res.status(404).json({ error: 'The recording was not found.' })
      return
    }
    const recording = await getWalkRecording(
      req.params.reference,
      req.params.walkId,
      seq.data,
      res.locals.user!,
    )
    await sendFile(req, res, recording, { 'Cache-Control': 'private, no-cache' })
  }),
)

// A photo taken during the walk: multipart `photo` file, `recordingSeq`, `offsetSec`.
router.put(
  '/:walkId/photos/:photoId',
  edit,
  multipartBody,
  guarded(async (req, res) => {
    const form = await readForm(req)
    const fields = photoFieldsSchema.safeParse({
      photoId: req.params.photoId,
      recordingSeq: form?.get('recordingSeq') ?? null,
      offsetSec: form?.get('offsetSec') ?? null,
    })
    if (!form || !fields.success) {
      res.status(400).json({
        error: 'Send the photo as a multipart form.',
        ...(!fields.success && { fields: fieldErrors(fields.error) }),
      })
      return
    }
    const media = await mediaParts(form)
    if ('error' in media) {
      res.status(media.status).json({ error: media.error })
      return
    }
    if (media.photos.length !== 1 || media.recordings.length || media.pages.length) {
      res.status(400).json({ error: 'Send exactly one photo.' })
      return
    }
    res.json(
      await addPhoto(
        req.params.reference,
        req.params.walkId,
        fields.data,
        media.photos[0].image,
        res.locals.user!,
      ),
    )
  }),
)

// The photo's image, for the review screen. It never changes under its id.
router.get(
  '/:walkId/photos/:photoId',
  view,
  guarded(async (req, res) => {
    const photo = await getWalkPhoto(
      req.params.reference,
      req.params.walkId,
      req.params.photoId,
      res.locals.user!,
    )
    await sendFile(req, res, photo, { 'Cache-Control': 'private, max-age=31536000, immutable' })
  }),
)

// A photo, handwritten page or voice clip added to the proposal by hand (round
// 3): multipart, exactly one `photo`, `page` or `recording` file.
router.put(
  '/:walkId/media/:mediaId',
  edit,
  multipartBody,
  guarded(async (req, res) => {
    const form = await readForm(req)
    const mediaId = mediaIdSchema.safeParse(req.params.mediaId)
    if (!form || !mediaId.success) {
      res.status(400).json({ error: 'Send the file as a multipart form under its UUID.' })
      return
    }
    const media = await mediaParts(form)
    if ('error' in media) {
      res.status(media.status).json({ error: media.error })
      return
    }
    const files = [
      ...media.photos.map((p) => ({ kind: 'photo' as const, body: p.image })),
      ...media.pages.map((p) => ({ kind: 'page' as const, body: p.image })),
      ...media.recordings.map((r) => ({
        kind: 'voice' as const,
        body: r.audio,
        contentType: r.contentType,
      })),
    ]
    if (files.length !== 1) {
      res.status(400).json({ error: 'Send exactly one photo, page or recording.' })
      return
    }
    res.json(
      await addProposalMedia(
        req.params.reference,
        req.params.walkId,
        mediaId.data,
        files[0],
        res.locals.user!,
      ),
    )
  }),
)

// An added item's file, for the review screen (Range supported). It never changes under its id.
router.get(
  '/:walkId/media/:mediaId',
  view,
  guarded(async (req, res) => {
    const media = await getProposalMedia(
      req.params.reference,
      req.params.walkId,
      req.params.mediaId,
      res.locals.user!,
    )
    await sendFile(req, res, media, { 'Cache-Control': 'private, max-age=31536000, immutable' })
  }),
)

router.put(
  '/:walkId/text',
  edit,
  guarded(async (req, res) => {
    const parsed = typedTextSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'The text is invalid.', fields: fieldErrors(parsed.error) })
      return
    }
    res.json(
      await setText(req.params.reference, req.params.walkId, parsed.data.text, res.locals.user!),
    )
  }),
)

// Ends the recording: JSON `{ name }`, the engineer's name for the walk.
router.post(
  '/:walkId/finish',
  edit,
  guarded(async (req, res) => {
    const parsed = walkNameSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'The name is invalid.', fields: fieldErrors(parsed.error) })
      return
    }
    res.json(
      await finishWalk(req.params.reference, req.params.walkId, parsed.data.name, res.locals.user!),
    )
  }),
)

// Renames the walk, in any state: JSON `{ name }`.
router.put(
  '/:walkId/name',
  edit,
  guarded(async (req, res) => {
    const parsed = walkNameSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'The name is invalid.', fields: fieldErrors(parsed.error) })
      return
    }
    res.json(
      await renameWalk(req.params.reference, req.params.walkId, parsed.data.name, res.locals.user!),
    )
  }),
)

router.post(
  '/:walkId/retry',
  edit,
  guarded(
    async (req, res) =>
      void res.json(await retryWalk(req.params.reference, req.params.walkId, res.locals.user!)),
  ),
)

// Saves the reviewed proposal, replacing the last one.
router.put(
  '/:walkId/proposal',
  edit,
  guarded(
    async (req, res) =>
      void res.json(
        await saveProposal(req.params.reference, req.params.walkId, req.body, res.locals.user!),
      ),
  ),
)

router.post(
  '/:walkId/create',
  edit,
  guarded(
    async (req, res) =>
      void res.json(await createAll(req.params.reference, req.params.walkId, res.locals.user!)),
  ),
)

router.delete(
  '/:walkId',
  edit,
  guarded(async (req, res) => {
    await discardWalk(req.params.reference, req.params.walkId, res.locals.user!)
    res.status(204).end()
  }),
)

router.use(tooLarge)

export default router
