// The extension a recording is stored and sent to Whisper under (CP-03, CP-08). Found by the
// demo seed: an .m4a the browser reports as audio/mp4 was stored as .mp4, and Whisper refused it.
import { describe, expect, it } from 'vitest'
import { audioExtension } from '../services/observation.service'

// The first bytes of an MP4 file: its size, then "ftyp" and the major brand.
const mp4 = (brand: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 28]), Buffer.from(`ftyp${brand}`)])

describe('audioExtension', () => {
  it('keeps .m4a for an M4A file reported as audio/mp4', () => {
    expect(audioExtension('audio/mp4', mp4('M4A '))).toBe('m4a')
  })

  it('keeps .mp4 for other MP4 audio, and for a type alone', () => {
    expect(audioExtension('audio/mp4', mp4('mp42'))).toBe('mp4')
    expect(audioExtension('audio/mp4')).toBe('mp4')
  })

  it('reads other types by their name only', () => {
    expect(audioExtension('audio/webm;codecs=opus', mp4('M4A '))).toBe('webm')
    expect(audioExtension('audio/x-m4a')).toBe('m4a')
    expect(audioExtension('video/quicktime')).toBeUndefined()
  })
})
