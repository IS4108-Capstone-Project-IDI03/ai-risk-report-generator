// What the walk's pickers accept (CP-22 AC9-AC13) and the browser check of a picked
// file. Called by RecordPanel and PhotoStrip (via Recording.tsx) and by useWalk's refusal
// toast. The gateway reads the real bytes too; this is only the friendly first check.

// Types are listed by MIME and extension, never `image/*`, which would admit SVG.
// iOS needs the image MIME types to offer the Photos library.
const PHOTO_MIME = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff',
  'image/bmp',
]
const PHOTO_EXT = [
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'webp',
  'avif',
  'gif',
  'tif',
  'tiff',
  'bmp',
]
const RECORDING_MIME = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/flac',
  'audio/x-flac',
  'audio/aac',
  'audio/x-aac',
  'audio/opus',
  'audio/amr',
  'audio/aiff',
  'audio/x-aiff',
  'audio/x-caf',
  'audio/x-ms-wma',
  'audio/3gpp',
  'audio/3gpp2',
  'video/mp4',
  'video/webm',
  'video/3gpp',
]
const RECORDING_EXT = [
  'webm',
  'ogg',
  'oga',
  'opus',
  'mp4',
  'm4a',
  'mp3',
  'wav',
  'flac',
  'aac',
  'amr',
  'aif',
  'aiff',
  'caf',
  'wma',
  '3gp',
  '3gpp',
]

const dotted = (ext: string[]) => ext.map((e) => '.' + e)
export const PHOTO_ACCEPT = [...PHOTO_MIME, ...dotted(PHOTO_EXT)].join(',')
export const RECORDING_ACCEPT = [...RECORDING_MIME, ...dotted(RECORDING_EXT)].join(',')

export type UploadKind = 'photo' | 'recording'
export type Refusal = { title: string; fix: string }

// Must match the gateway's limits (server/src/routes/site-walk.routes.ts).
const LIMIT = { photo: 20_000_000, recording: 100_000_000 }

const choose = (kind: UploadKind) => (kind === 'photo' ? 'Choose a photo' : 'Choose a recording')
const extensionOf = (name: string) =>
  name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''

// Returns the wrong-type words for a file's name; shared with the gateway-refusal toast.
export function wrongType(name: string, kind: UploadKind): Refusal {
  const ext = extensionOf(name)
  return { title: ext ? `Can't add .${ext} files` : "Can't add this file", fix: choose(kind) }
}

// Returns null when the file may go on, else the words for the error toast. Decides by the
// reported type, then the extension; a file with neither goes to the gateway to judge.
export function refusalOf(
  file: { name: string; type: string; size: number },
  kind: UploadKind,
): Refusal | null {
  const mime = kind === 'photo' ? PHOTO_MIME : RECORDING_MIME
  const exts = kind === 'photo' ? PHOTO_EXT : RECORDING_EXT
  const type = file.type === 'application/octet-stream' ? '' : file.type.toLowerCase()
  const ext = extensionOf(file.name)
  const known = mime.includes(type) || exts.includes(ext)
  if ((type || ext) && !known) return wrongType(file.name, kind)
  if (file.size > LIMIT[kind]) return { title: 'File is too large', fix: 'Choose a smaller one' }
  return null
}
