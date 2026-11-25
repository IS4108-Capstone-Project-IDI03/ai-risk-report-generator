// Tests for the CP-24 gateway calls: each hits the contract's route with the contract's body,
// and a fixture in the contract's shape compiles as a SavedObservation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmSuggestion,
  createDraftRecordings,
  discardDraft,
  getObservation,
  retrySuggestion,
  saveObservation,
  type SavedObservation,
  type SavedSuggestion,
  updateObservation,
} from './api'

const suggestion: SavedSuggestion = {
  status: 'done',
  error: null,
  category: { notSure: false },
  severity: { notSure: true },
}
// The gateway's DTO after CP-24: no severity yet, a suggestion and toCheck.
const draft: SavedObservation = {
  id: 'd1',
  engineer: 'Alex Rowe',
  copeDimensions: null,
  standard: null,
  severity: null,
  location: null,
  note: null,
  recordings: [],
  photos: [],
  removedRecordings: [],
  removedPhotos: [],
  interpretation: { photos: null },
  suggestion,
  toCheck: true,
  recordedAt: '2026-11-20T00:00:00Z',
  edited: null,
  deleted: null,
}

type Call = { method?: string; url: string; body?: BodyInit | null }
let calls: Call[] = []
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method, body: init.body })
    const body = url.endsWith('/draft') && init.method === 'POST' ? { draft } : draft
    return Promise.resolve(
      init.method === 'DELETE' && url.endsWith('/draft')
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(body), { status: 200 }),
    )
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('CP-24 observation calls', () => {
  it('uploads recordings to the draft, naming an existing draft when there is one', async () => {
    const audio = new Blob(['x'], { type: 'audio/webm' })
    const made = await createDraftRecordings('RPT-1', [{ name: 'a.webm', audio }])
    expect(made.id).toBe('d1')
    await createDraftRecordings('RPT-1', [{ name: 'b.webm', audio }], 'd1')
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', '/api/assessments/RPT-1/observations/draft'],
      ['POST', '/api/assessments/RPT-1/observations/draft'],
    ])
    expect((calls[0].body as FormData).get('draftId')).toBeNull()
    expect((calls[1].body as FormData).get('draftId')).toBe('d1')
    expect((calls[1].body as FormData).getAll('recording')).toHaveLength(1)
  })

  it('reads one observation, and discards a draft', async () => {
    expect((await getObservation('d1')).toCheck).toBe(true)
    await discardDraft('d1')
    expect(calls.map((c) => [c.method ?? 'GET', c.url])).toEqual([
      ['GET', '/api/observations/d1'],
      ['DELETE', '/api/observations/d1/draft'],
    ])
  })

  it('confirms by PATCH with confirm, and retries by POST', async () => {
    await confirmSuggestion('o1', ['severity'])
    await retrySuggestion('o1')
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: '/api/observations/o1' })
    expect(JSON.parse(String(calls[0].body))).toEqual({ confirm: ['severity'] })
    expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/observations/o1/suggestion/retry' })
  })

  it('saves with only a location, or with a draft id, and can empty the severity', async () => {
    await saveObservation('RPT-1', { locationId: 'l1', draftId: 'd1' }, [])
    expect(JSON.parse(String((calls[0].body as FormData).get('details')))).toEqual({
      locationId: 'l1',
      draftId: 'd1',
    })
    await updateObservation('o1', { severity: null })
    expect(JSON.parse(String(calls[1].body))).toEqual({ severity: null })
  })
})
