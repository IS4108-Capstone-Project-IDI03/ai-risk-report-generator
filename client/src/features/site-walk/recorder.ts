// Browser media for a site walk (CP-22): one camera-and-microphone stream per
// walk, audio-only recordings from it, still photos from its video, and the
// screen kept awake. Used by useWalkRecorder and CameraView.

// Each recording stops here so it never gets too large to transcribe (AC2).
export const CAP_SEC = 20 * 60
// A tone and a line warn the engineer this long before the cap.
export const WARN_SEC = 19 * 60

// Plays a short, soft beep so the engineer hears the cap coming without looking.
// Skipped silently where Web Audio is missing or the browser blocks it.
export function playTone() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.15
    osc.connect(gain).connect(ctx.destination)
    osc.onended = () => void ctx.close().catch(() => {})
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
  } catch {
    // No sound is fine: the on-screen line and toast still tell the engineer.
  }
}

// Returns one stream for the whole walk: microphone and back camera, or the
// microphone alone when there is no camera or it is refused (e.g. a laptop).
export async function openWalkStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: 'environment' },
    })
  } catch {
    // A refused microphone fails this retry too, and the caller says why.
    return navigator.mediaDevices.getUserMedia({ audio: true })
  }
}

// Records the stream's audio track only, so the video never goes into the
// recording. onDone gets the clip once the recorder stops, however it stops.
export function recordAudio(stream: MediaStream, onDone: (audio: Blob) => void): MediaRecorder {
  const recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), {
    audioBitsPerSecond: 64_000,
  })
  const chunks: Blob[] = []
  let finished = false
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  recorder.onstop = () => {
    // Some browsers fire stop twice when the track ends; send the clip once.
    if (finished) return
    finished = true
    onDone(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
  }
  // A chunk each second, so a track that ends suddenly still leaves what was said.
  recorder.start(1000)
  return recorder
}

// Returns a JPEG of the video's current frame, at the camera's full size.
export function grabStill(video: HTMLVideoElement): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')?.drawImage(video, 0, 0)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
}

// Keeps the screen on while recording, where the browser allows (Screen Wake
// Lock); returns how to let it sleep again. Without it a locking phone ends the
// microphone track and the recording with it.
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request('screen')
    return () => void lock?.release().catch(() => {})
  } catch {
    // Unsupported or refused (e.g. Low Power Mode): record anyway.
    return () => {}
  }
}

// "07:32"
export const clock = (sec: number) =>
  String(Math.floor(sec / 60)).padStart(2, '0') +
  ':' +
  String(Math.floor(sec % 60)).padStart(2, '0')

// Why the microphone could not start, then what to do instead.
export function mediaProblem(error: unknown) {
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return "Microphone access is blocked. Allow it in your browser's site settings, or add a typed note instead."
  if (name === 'NotFoundError')
    return 'No microphone was found. Connect one, or add a typed note instead.'
  return 'The microphone could not be started. You can add a typed note instead.'
}
