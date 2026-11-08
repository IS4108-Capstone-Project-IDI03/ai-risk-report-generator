// Small real audio and image files for the site walk upload tests (Sprint 4
// fixes, CP-22), made with the same ffmpeg binary the gateway uses. Used by
// site-walk.test.ts.
import { execFileSync } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'

// `seconds` of a sine tone in the container `ext`, encoded with `codecArgs`.
export function audioFile(ext: string, codecArgs: string[], seconds = 1): Buffer {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fixture-'))
  try {
    const out = path.join(dir, `a.${ext}`)
    execFileSync(
      ffmpegPath as string,
      ['-v', 'error', '-f', 'lavfi', '-i', `sine=d=${seconds}`, '-ac', '1', ...codecArgs, out],
      { stdio: 'ignore' },
    )
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// 12 s long, the length the older walk tests send as the client's own.
export const webmAudio = () => audioFile('webm', ['-c:a', 'libopus'], 12)
export const mp3Audio = () => audioFile('mp3', ['-c:a', 'libmp3lame'])
export const wavAudio = () => audioFile('wav', ['-c:a', 'pcm_s16le', '-ar', '8000'])
export const aacAudio = () => audioFile('aac', ['-c:a', 'aac'])
export const aiffAudio = () => audioFile('aiff', ['-c:a', 'pcm_s16be', '-ar', '8000'])

// A 32x32 red BMP, which sharp cannot make, so ffmpeg does.
export function bmpImage(): Buffer {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fixture-'))
  try {
    const out = path.join(dir, 'a.bmp')
    execFileSync(
      ffmpegPath as string,
      ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', out],
      { stdio: 'ignore' },
    )
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// `seconds` of mono silence at a tiny bitrate, so a 25 minute file stays small and quick.
// Written to a file, with optional tags; or, with `toPipe`, to ffmpeg's stdout, which gives
// a container with no Duration (what a browser's live WebM looks like).
export function silentAudio(
  ext: string,
  codecArgs: string[],
  seconds: number,
  opts: { toPipe?: boolean; tags?: string[] } = {},
): Buffer {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fixture-'))
  try {
    const out = path.join(dir, `a.${ext}`)
    const args = [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=8000:cl=mono`,
      '-t',
      String(seconds),
      ...codecArgs,
      ...(opts.tags ?? []),
      ...(opts.toPipe ? ['-f', ext, 'pipe:1'] : [out]),
    ]
    if (opts.toPipe)
      return execFileSync(ffmpegPath as string, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      })
    execFileSync(ffmpegPath as string, args, { stdio: 'ignore' })
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
