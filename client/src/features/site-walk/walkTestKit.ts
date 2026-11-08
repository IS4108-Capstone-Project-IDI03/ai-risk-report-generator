// Shared fakes for the site walk Recording tests: a stand-in gateway, a fake
// microphone and camera, and a counter of tones played. Used by recording.test.tsx
// and walkList.test.tsx.
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import type { SiteWalk } from './api'

export const tones = { count: 0 }

// Presses Finish walk, names the walk in the dialog it opens, and submits.
export function finishAs(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Finish walk' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByRole('textbox', { name: /^Name/ }), { target: { value: name } })
  fireEvent.click(dialog.getByRole('button', { name: 'Finish walk' }))
}

export const REF = 'RPT-2026-0411'
export const BASE = `/api/assessments/${REF}/site-walks`
// Returns a JSON response from the fake gateway.
export const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A stand-in for the gateway's site walk routes; every call is logged.
export const gw: {
  walk: SiteWalk
  calls: { method: string; url: string; body?: BodyInit | null }[]
  offline: boolean
  // Makes every recording and photo upload answer with this refusal.
  refuse: { status: number; code?: string } | null
  // Makes every delete fail, as a dropped connection would.
  failDeletes: boolean
} = { walk: {} as SiteWalk, calls: [], offline: false, refuse: null, failDeletes: false }
// Resets the walk and installs the fake gateway routes.
export function mockGateway() {
  gw.walk = {
    id: 'w1',
    status: 'recording',
    name: null,
    createdAt: '2026-10-29T08:00:00.000Z',
    recordings: [],
    photos: [],
    notes: [],
    typedText: null,
    proposal: null,
    error: null,
  }
  gw.calls = []
  gw.offline = false
  gw.refuse = null
  gw.failDeletes = false
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    gw.calls.push({ method, url, body: init.body })
    if (gw.offline) return Promise.reject(new TypeError('Failed to fetch'))
    const rec = /recordings\/(\d+)$/.exec(url)
    const walk = gw.walk
    if (gw.refuse && method === 'PUT' && /(recordings|photos)\//.test(url))
      return json(gw.refuse.status, { error: 'Refused', code: gw.refuse.code })
    if (method === 'DELETE' && gw.failDeletes) return json(500, { error: 'Down' })
    if (method === 'DELETE' && rec)
      walk.recordings = walk.recordings.filter((r) => r.seq !== +rec[1])
    const retry = /recordings\/(\d+)\/retry$/.exec(url)
    if (retry && method === 'POST')
      walk.recordings.forEach((r) => {
        if (r.seq === +retry[1] && r.transcription === 'failed') r.transcription = 'queued'
      })
    if (rec && method === 'PUT') {
      const seq = Number(rec[1])
      const durationSec = Number((init.body as FormData).get('durationSec'))
      walk.recordings.push({
        seq,
        durationSec,
        transcription: 'queued',
        transcript: null,
        audioUrl: `${BASE}/w1/recordings/${seq}`,
      })
    }
    const photo = /photos\/([\w-]+)$/.exec(url)
    if (method === 'DELETE' && photo) walk.photos = walk.photos.filter((p) => p.id !== photo[1])
    if (photo && method === 'PUT') {
      const form = init.body as FormData
      const at = form.get('offsetSec')
      walk.photos.push({
        id: photo[1],
        url: `/photo/${photo[1]}.jpg`,
        recordingSeq: form.get('recordingSeq') ? Number(form.get('recordingSeq')) : null,
        offsetSec: at ? Number(at) : null,
      })
    }
    const note = /notes\/(\d+)$/.exec(url)
    if (note) {
      const seq = Number(note[1])
      const text = JSON.parse(String(init.body)).text as string
      const rest = (walk.notes ?? []).filter((n) => n.seq !== seq)
      walk.notes = text.trim() ? [...rest, { seq, text }] : rest
    }
    if (url.endsWith('/finish')) walk.status = 'transcribing'
    return json(method === 'POST' && url === BASE ? 201 : 200, walk)
  })
}

// jsdom has no microphone or camera: one fake stream with an audio and a video
// track, and a MediaRecorder that hands over a clip when stopped.
export class FakeTrack extends EventTarget {
  readyState = 'live'
  stop() {
    this.readyState = 'ended'
  }
}
export let audioTrack: FakeTrack
// Installs fake microphone, camera and recorder browser APIs.
export function allowMedia() {
  audioTrack = new FakeTrack()
  const video = new FakeTrack()
  const stream = {
    getAudioTracks: () => [audioTrack],
    getVideoTracks: () => [video],
    getTracks: () => [audioTrack, video],
  }
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  })
  vi.stubGlobal('MediaStream', class {})
  vi.stubGlobal(
    'MediaRecorder',
    class {
      state = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: (e: { data: Blob }) => void = () => {}
      onstop: () => void = () => {}
      start() {
        this.state = 'recording'
      }
      pause() {
        this.state = 'paused'
      }
      resume() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable({ data: new Blob(['audio'], { type: 'audio/webm' }) })
        this.onstop()
      }
    },
  )
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }),
  )
  // Web Audio: every beep started is counted.
  tones.count = 0
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 0
      destination = {}
      createGain = () => ({ gain: { value: 0 }, connect: (n: unknown) => n })
      createOscillator = () => {
        const osc = {
          frequency: { value: 0 },
          connect: (n: unknown) => n,
          start: () => void tones.count++,
          stop() {},
          onended: null,
        }
        return osc
      }
      close = async () => {}
    },
  )
  // A camera frame becomes a JPEG without a real canvas.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {},
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
    done(new Blob(['jpg'], { type: 'image/jpeg' })),
  )
}

// Fake timers, gateway, media and a fresh localStorage around every test.
export function installWalkTest() {
  beforeEach(() => {
    // setImmediate stays real: React's act flushes updates with it.
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    mockGateway()
    allowMedia()
    // jsdom has no <dialog> methods; the photo viewer and help sheet use them.
    HTMLDialogElement.prototype.showModal ??= function () {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close ??= function () {
      this.removeAttribute('open')
    }
    // Node 25+ has its own localStorage that hides jsdom's, so each test brings a fresh one.
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
}
