// Checks what the person picked for the walk (CP-22 AC12): the browser's own look at each
// file before it is kept. Called by screens/Recording.tsx. Words from uploadTypes.ts.
import { toast } from '../../design-system'
import { refusalOf, type UploadKind } from './uploadTypes'

// Returns the files that may go on; each other one gets an error toast and is never kept.
export function acceptFiles(files: File[], kind: UploadKind): File[] {
  return files.filter((file) => {
    const refusal = refusalOf(file, kind)
    if (refusal) toast.error(refusal.title, { description: refusal.fix })
    return !refusal
  })
}

// Returns a recording file's length in whole seconds, read from its metadata; 0 when the
// browser can't tell (the gateway reads the real length again).
export function audioLength(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const finish = (seconds: number) => {
      window.clearTimeout(giveUp)
      URL.revokeObjectURL(url)
      resolve(seconds)
    }
    // Without this a file the browser never reports on would hold the upload for ever.
    const giveUp = window.setTimeout(() => finish(0), 3000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0)
    audio.onerror = () => finish(0)
    audio.src = url
  })
}
