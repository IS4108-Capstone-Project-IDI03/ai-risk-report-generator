import express, { type ErrorRequestHandler, type Request } from 'express'
import {
  audioExtension,
  photoFormat,
  type NewPhoto,
  type NewRecording,
} from '../services/observation.service'

// Recordings and photos arrive as a multipart form, buffered in memory, both
// when an observation is captured (CP-02, CP-03, CP-04) and when they are
// added to a saved one (CP-08). 100 MB in all.
// ponytail: the whole form is buffered in memory; stream it to S3 if uploads
// grow past a few recordings.
export const multipartBody = express.raw({ type: 'multipart/form-data', limit: '100mb' })

// express.raw rejects a body over the limit before the handler runs.
export const tooLarge: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type !== 'entity.too.large') return next(error)
  res.status(413).json({
    error: 'The recordings and photos are larger than 100 MB in total. Save fewer at once.',
  })
}

// The request's multipart form, or null when it isn't one.
export async function readForm(req: Request): Promise<FormData | null> {
  try {
    return await new Response(req.body, {
      headers: { 'Content-Type': req.get('Content-Type') ?? '' },
    }).formData()
  } catch {
    return null
  }
}

// The form's `recording` and `photo` parts, checked the same way wherever
// they are sent: each recording in a format Whisper reads and up to 25 MB, the
// Whisper upload limit; each photo a JPG or PNG by its first bytes, not the
// type the browser reports (CP-04 AC4), and up to 20 MB; none empty. A problem
// comes back with its status and reason, and nothing is kept.
export async function mediaParts(
  form: FormData,
): Promise<
  { recordings: NewRecording[]; photos: NewPhoto[] } | { status: 400 | 413 | 415; error: string }
> {
  const files = form.getAll('recording').filter((part) => part instanceof File)
  if (files.some((file) => !audioExtension(file.type)))
    return {
      status: 415,
      error: 'This audio format is not supported. Use WebM, Ogg, MP4, M4A, MP3, WAV or FLAC.',
    }
  if (files.some((file) => file.size > 25 * 1024 * 1024))
    return { status: 413, error: 'A recording is larger than 25 MB. Upload a shorter one.' }
  if (files.some((file) => file.size === 0)) return { status: 400, error: 'A recording is empty.' }

  const photoFiles = form.getAll('photo').filter((part) => part instanceof File)
  if (photoFiles.some((file) => file.size > 20 * 1024 * 1024))
    return { status: 413, error: 'A photo is larger than 20 MB. Upload a smaller one.' }
  if (photoFiles.some((file) => file.size === 0)) return { status: 400, error: 'A photo is empty.' }
  const photos = await Promise.all(
    photoFiles.map(async (file, i) => ({
      name: file.name || `Photo ${i + 1}`,
      image: Buffer.from(await file.arrayBuffer()),
    })),
  )
  const unsupported = photos.find((photo) => !photoFormat(photo.image))
  if (unsupported)
    return {
      status: 415,
      error: `${unsupported.name} is not a JPG or PNG image. Save it as JPG or PNG and add it again.`,
    }

  const recordings = await Promise.all(
    files.map(async (file, i) => ({
      name: file.name || `Recording ${i + 1}`,
      audio: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    })),
  )
  return { recordings, photos }
}
