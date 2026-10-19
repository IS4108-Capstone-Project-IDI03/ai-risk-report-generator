import express, { type ErrorRequestHandler, type Request } from 'express'
import {
  audioExtension,
  photoFormat,
  type NewPage,
  type NewPhoto,
  type NewRecording,
} from '../services/observation.service'

// Recordings, photos and handwritten pages arrive as a multipart form, buffered
// in memory, both when an observation is captured (CP-02, CP-03, CP-04, CP-19)
// and when recordings and photos are added to a saved one (CP-08). 100 MB in all.
// ponytail: the whole form is buffered in memory; stream it to S3 if uploads
// grow past a few recordings.
export const multipartBody = express.raw({ type: 'multipart/form-data', limit: '100mb' })

// express.raw rejects a body over the limit before the handler runs.
export const tooLarge: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type !== 'entity.too.large') return next(error)
  res.status(413).json({
    error: 'The recordings, photos and pages are larger than 100 MB in total. Save fewer at once.',
  })
}

// A form's images under one part name, checked as photos are (CP-04 AC4): each a
// JPG or PNG by its first bytes, up to 20 MB, none empty.
async function imageParts(
  form: FormData,
  part: 'photo' | 'page',
): Promise<{ name: string; image: Buffer }[] | { status: 400 | 413 | 415; error: string }> {
  const noun = part === 'photo' ? 'photo' : 'page'
  const files = form.getAll(part).filter((p) => p instanceof File)
  if (files.some((file) => file.size > 20 * 1024 * 1024))
    return { status: 413, error: `A ${noun} is larger than 20 MB. Upload a smaller one.` }
  if (files.some((file) => file.size === 0)) return { status: 400, error: `A ${noun} is empty.` }
  const images = await Promise.all(
    files.map(async (file, i) => ({
      name: file.name || `${part === 'photo' ? 'Photo' : 'Page'} ${i + 1}`,
      image: Buffer.from(await file.arrayBuffer()),
    })),
  )
  const unsupported = images.find((image) => !photoFormat(image.image))
  if (unsupported)
    return {
      status: 415,
      error: `${unsupported.name} is not a JPG or PNG image. Save it as JPG or PNG and add it again.`,
    }
  return images
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

// The form's `recording`, `photo` and `page` parts, checked the same way
// wherever they are sent: each recording in a format Whisper reads and up to
// 25 MB, the Whisper upload limit; each photo and handwritten page (CP-19) a
// JPG or PNG by its first bytes, not the type the browser reports (CP-04 AC4),
// and up to 20 MB; none empty. A problem comes back with its status and reason,
// and nothing is kept.
export async function mediaParts(
  form: FormData,
): Promise<
  | { recordings: NewRecording[]; photos: NewPhoto[]; pages: NewPage[] }
  | { status: 400 | 413 | 415; error: string }
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

  const photos = await imageParts(form, 'photo')
  if ('error' in photos) return photos
  const pages = await imageParts(form, 'page')
  if ('error' in pages) return pages

  const recordings = await Promise.all(
    files.map(async (file, i) => ({
      name: file.name || `Recording ${i + 1}`,
      audio: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    })),
  )
  return { recordings, photos, pages }
}
