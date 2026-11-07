// Reads the bytes of an uploaded site walk photo or recording and turns it into
// something the rest of the system already handles (Sprint 4 fixes, CP-22): a
// JPG or PNG photo, a recording Whisper reads. Called by routes/media-form.ts.
// Calls sharp, heic-convert and the ffmpeg binary. The bytes are untrusted, so
// the format is read from them, never from the file name or reported type.
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { promises as fs } from 'fs'
import convertHeic from 'heic-convert'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { photoFormat } from './observation.service'

export type Refusal = { code: 'wrong_type' | 'too_large' | 'too_long' }
const MB = 1024 * 1024
const MAX_RECORDING_SEC = 20 * 60 + 5 // 20 minutes, plus 5 s of slack
const FFMPEG_TIMEOUT_MS = 120_000
// Only audio containers may be opened. Without this, ffmpeg would follow a
// playlist (.m3u8, concat) to other files on the server or the network.
const AUDIO_DEMUXERS =
  'matroska,webm,ogg,mov,mp4,m4a,3gp,3g2,mj2,mp3,wav,flac,aac,amr,amrnb,amrwb,aiff,caf,asf'
const SAFE_FLAGS = ['-nostdin', '-hide_banner', '-protocol_whitelist', 'file']

// Runs ffmpeg without a shell; returns its error output, or null when it
// timed out and was killed. Without the kill, one bad file could hold a worker forever.
function runFfmpeg(args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let log = ''
    child.stderr.on('data', (chunk) => (log = (log + chunk).slice(-65_536)))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(null)
    }, FFMPEG_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(log)
    })
  })
}

// Runs `work` with a fresh temp folder holding `bytes` as `name`; the folder is
// always removed, so no uploaded file stays on disk.
async function withTempFile<T>(
  bytes: Buffer,
  name: string,
  work: (file: string, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-'))
  try {
    const file = path.join(dir, name)
    await fs.writeFile(file, bytes)
    return await work(file, dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

// The brand in bytes 4-11 of a HEIC/HEIF file ("ftyp" + brand).
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']
const isHeic = (b: Buffer) =>
  b.subarray(4, 8).toString('latin1') === 'ftyp' &&
  HEIC_BRANDS.includes(b.subarray(8, 12).toString('latin1'))
const isBmp = (b: Buffer) => b.subarray(0, 2).toString('latin1') === 'BM'

// Formats sharp may open; SVG, PDF and the rest are refused.
const SHARP_FORMATS = ['webp', 'heif', 'avif', 'gif', 'tiff']

// A photo as a JPG or PNG: those two come back byte for byte, HEIC, BMP, WebP,
// AVIF, GIF and TIFF come back as a JPEG (quality 85, rotated upright, metadata
// dropped), anything else, or a damaged file, is refused.
export async function toStoredPhoto(
  bytes: Buffer,
): Promise<{ image: Buffer; contentType: 'image/jpeg' | 'image/png' } | Refusal> {
  const kept = photoFormat(bytes)
  if (kept) return { image: bytes, contentType: kept.contentType }
  try {
    // An AVIF can carry the same brand as a HEIC (mif1), so a failed HEIC read falls
    // through to sharp. Without this such an AVIF would be refused.
    let source: Buffer | null = isHeic(bytes)
      ? await convertHeic({ buffer: bytes, format: 'JPEG', quality: 1 }).then(
          (jpeg) => Buffer.from(jpeg),
          () => null,
        )
      : null
    if (!source && isBmp(bytes)) source = await bmpToPng(bytes)
    if (!source) {
      const { format } = await sharp(bytes).metadata()
      if (!format || !SHARP_FORMATS.includes(format)) return { code: 'wrong_type' }
      source = bytes
    }
    const image = await sharp(source)
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { image, contentType: 'image/jpeg' }
  } catch {
    return { code: 'wrong_type' }
  }
}

// Turns a BMP into a PNG with ffmpeg, since sharp cannot read BMP.
function bmpToPng(bytes: Buffer): Promise<Buffer> {
  return withTempFile(bytes, 'in.bmp', async (file, dir) => {
    const out = path.join(dir, 'out.png')
    const log = await runFfmpeg([
      ...SAFE_FLAGS,
      '-format_whitelist',
      'bmp_pipe,image2',
      '-i',
      file,
      '-frames:v',
      '1',
      out,
    ])
    if (log === null) throw new Error('ffmpeg timed out')
    return fs.readFile(out)
  })
}

// "00:25:00.40" as whole seconds.
const seconds = (clock: string) => {
  const [h, m, s] = clock.split(':').map(Number)
  return Math.round(h * 3600 + m * 60 + s)
}

// Reads a file's real length by walking its audio, for a container that doesn't say.
// Browser WebM usually doesn't; without this one could slip past the 20-minute limit.
async function measuredLength(file: string) {
  const log = await runFfmpeg([
    ...SAFE_FLAGS,
    '-format_whitelist',
    AUDIO_DEMUXERS,
    '-i',
    file,
    '-map',
    '0:a:0',
    '-c',
    'copy',
    '-f',
    'null',
    '-',
  ])
  const last = [...(log ?? '').matchAll(/time=(\d+:\d+:\d+(?:\.\d+)?)/g)].at(-1)
  return last ? seconds(last[1]) : null
}

type Probe = { format: string; hasAudio: boolean; durationSec: number | null; brand: string }

// What ffmpeg says about a file: its container, whether it has audio and its
// length (null when the container does not say, as browser WebM often does).
async function probe(file: string): Promise<Probe | null> {
  const log = await runFfmpeg([...SAFE_FLAGS, '-format_whitelist', AUDIO_DEMUXERS, '-i', file])
  if (log === null) return null
  const format = /^Input #0, ([^,\n]+(?:,[^,\n]+)*?), from /m.exec(log)?.[1] ?? ''
  // Anchored to ffmpeg's own lines. A file's title tag can say "Duration: 00:00:01",
  // and without this a 25-minute file would pass the limit as one second.
  const time = /^ {2}Duration: (\d+:\d+:\d+(?:\.\d+)?)/m.exec(log)
  return {
    format,
    hasAudio: /^ {2,}Stream #0:\d+.*: Audio:/m.test(log),
    durationSec: time ? seconds(time[1]) : null,
    brand: /major_brand\s*:\s*(\S+)/.exec(log)?.[1] ?? '',
  }
}

// The content type for a container Whisper reads, else undefined. 3GP shares
// the MP4 family but Whisper cannot be trusted with it, so it is converted.
function whisperType(info: Probe): string | undefined {
  const f = info.format
  if (f.startsWith('matroska')) return 'audio/webm'
  if (f === 'ogg') return 'audio/ogg'
  if (f === 'mp3') return 'audio/mpeg'
  if (f === 'wav') return 'audio/wav'
  if (f === 'flac') return 'audio/flac'
  if (f.startsWith('mov') && !info.brand.startsWith('3g'))
    return info.brand === 'M4A' ? 'audio/x-m4a' : 'audio/mp4'
  return undefined
}

// A recording Whisper can read, with its length from the file (null if the file
// does not say). Whisper formats up to 25 MB come back unchanged, other audio
// becomes mono AAC at 64 kbps in .m4a; no audio, over 20 minutes or still over
// 25 MB is refused.
export async function toStoredRecording(
  bytes: Buffer,
): Promise<{ audio: Buffer; contentType: string; durationSec: number | null } | Refusal> {
  return withTempFile(bytes, 'input.bin', async (file, dir) => {
    const info = await probe(file)
    if (!info?.hasAudio) return { code: 'wrong_type' }
    const durationSec = info.durationSec ?? (await measuredLength(file))
    if (durationSec !== null && durationSec > MAX_RECORDING_SEC) return { code: 'too_long' }
    const type = whisperType(info)
    if (type && bytes.length <= 25 * MB) return { audio: bytes, contentType: type, durationSec }

    const out = path.join(dir, 'out.m4a')
    const log = await runFfmpeg([
      ...SAFE_FLAGS,
      '-format_whitelist',
      AUDIO_DEMUXERS,
      '-i',
      file,
      '-vn',
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      out,
    ])
    if (log === null) return { code: 'wrong_type' }
    const audio = await fs.readFile(out).catch(() => null)
    if (!audio?.length) return { code: 'wrong_type' }
    if (audio.length > 25 * MB) return { code: 'too_large' }
    const length = (await probe(out))?.durationSec ?? durationSec
    if (length !== null && length > MAX_RECORDING_SEC) return { code: 'too_long' }
    return { audio, contentType: 'audio/x-m4a', durationSec: length }
  })
}
