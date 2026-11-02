// Serves a stored file honouring the HTTP Range header (CP-22). Called by the
// audio and photo routes in observation.routes.ts and site-walk.routes.ts.
// Safari will not play audio without it, and the observation page uses it to
// play a walk clip from `#t=start,end`.
import type { Request, Response } from 'express'
import { pipeline, type Readable } from 'stream'
import type { ByteRange } from '../services/storage.service'

/** Returns the byte range asked for, null to send the whole file, or 'unsatisfiable'. */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null | 'unsatisfiable' {
  // Only one range is served; anything else is answered with the whole file.
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    // "-n" is the last n bytes.
    const length = Number(match[2])
    return length === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(0, size - length), end: size - 1 }
  }
  const start = Number(match[1])
  if (start >= size) return 'unsatisfiable'
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  // A reversed range ("5-3") is invalid, so it is ignored (RFC 9110): the whole file.
  return end < start ? null : { start, end }
}

/** Sends the file, or the part of it the Range header asks for (206). Returns nothing. */
export async function sendFile(
  req: Request,
  res: Response,
  file: {
    contentType: string
    size: number
    open: (range?: ByteRange) => Promise<Readable>
  },
  headers: Record<string, string> = {},
) {
  res.set({ 'Content-Type': file.contentType, 'Accept-Ranges': 'bytes', ...headers })
  const range = parseRange(req.headers.range, file.size)
  if (range === 'unsatisfiable') {
    res.set('Content-Range', `bytes */${file.size}`).status(416).end()
    return
  }
  if (range) {
    res.status(206).set({
      'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
      'Content-Length': String(range.end - range.start + 1),
    })
  } else {
    res.set('Content-Length', String(file.size))
  }
  // pipeline, unlike pipe, closes the S3 stream when the browser cancels (Safari
  // does on every seek) and ends the response on an S3 error. Without it, open
  // streams would use up the S3 client's sockets and an error would crash the gateway.
  pipeline(await file.open(range ?? undefined), res, (error) => {
    if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE')
      console.error('Streaming a file failed:', error.message)
  })
}
