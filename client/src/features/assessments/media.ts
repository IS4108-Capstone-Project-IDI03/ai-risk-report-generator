// Picking and recording media in the browser, shared by the capture screen
// (CP-03, CP-04) and adding to a saved observation (CP-08).

// The photo formats the gateway stores (CP-04 AC4); image/jpg is an old alias.
export const PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png']

// Chosen files split into photos the gateway stores and the names of those it
// refuses. A file with no type is let through: the gateway checks the image
// itself, as a browser can report none.
export function choosePhotos(files: File[]) {
  const refused = files.filter((f) => f.type && !PHOTO_TYPES.includes(f.type))
  return { photos: files.filter((f) => !refused.includes(f)), refused: refused.map((f) => f.name) }
}

// Why chosen files were not added as photos, worded as the gateway words it.
export function unsupportedPhotos(names: string[]) {
  return names.length === 1
    ? names[0] + ' isn’t a JPG or PNG.'
    : names.join(', ') + ' aren’t JPG or PNG.'
}

// Why the microphone could not start (CP-03 AC8), then what to do instead.
export function microphoneProblem(error: unknown) {
  // A DOMException, which is not an Error instance in every browser.
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return "Microphone access is blocked. Allow it in your browser's site settings, or upload a recording instead."
  if (name === 'NotFoundError')
    return 'No microphone was found. Connect one, or upload a recording instead.'
  return 'The microphone could not be started. Upload a recording instead.'
}

// "00:47", how long a recording ran.
export const clipLength = (ms: number) => {
  const secs = Math.round(ms / 1000)
  return String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0')
}

// Records from the microphone until the recorder it returns is stopped, then
// hands over the clip and its length and releases the microphone. Throws when
// the microphone can't start; microphoneProblem says why.
export async function record(
  onClip: (audio: Blob, length: string) => void,
): Promise<MediaRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream)
  const startedAt = Date.now()
  recorder.ondataavailable = (event) => chunks.push(event.data)
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop())
    onClip(
      new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
      clipLength(Date.now() - startedAt),
    )
  }
  recorder.start()
  return recorder
}

// Whole seconds in "00:47" (what `clipLength` writes); 0 when it is not that.
export const clipSeconds = (length: string | null) => {
  const [m, s] = (length ?? '').split(':').map(Number)
  return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : 0
}

// How long an audio file runs, read from its own header; 0 when the browser can't say.
// Without the 0, an unreadable file would leave its row's length waiting for ever.
export function audioSeconds(audio: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(audio)
    const el = new Audio()
    const done = (seconds: number) => {
      URL.revokeObjectURL(url)
      resolve(seconds)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration) : 0)
    el.onerror = () => done(0)
    el.src = url
  })
}
