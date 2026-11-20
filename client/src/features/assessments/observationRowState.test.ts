// Tests for the one row-state rule (CP-24): status, tint, reason and the To check filter.
import { describe, expect, it } from 'vitest'
import {
  inToCheck,
  matchesStatus,
  rowStateOf,
  toCheckCount,
  type RowStateInput,
} from './observationRowState'

const done = { status: 'transcribed' }
const base: RowStateInput = { cats: ['Protection'], sev: 'high', toCheck: false }
const state = (over: Partial<RowStateInput>) => rowStateOf({ ...base, ...over })

describe('row status, first match wins', () => {
  it('is Complete when nothing is open', () => {
    expect(state({})).toEqual({ status: 'Complete', tint: null, reason: null })
  })

  it('Transcribing beats Reading, Transcription failed and To check', () => {
    const s = state({
      recordings: [{ status: 'transcribing' }, { status: 'failed' }],
      suggestion: { status: 'reading', error: null, category: null, severity: null },
      toCheck: true,
    })
    expect(s.status).toBe('Transcribing')
    expect(s.tint).toBeNull()
  })

  it('a page transcribing counts as Transcribing too', () => {
    expect(state({ pages: [{ status: 'transcribing' }] }).status).toBe('Transcribing')
  })

  it('Reading while the suggestion runs, tinted blue', () => {
    const s = state({
      suggestion: { status: 'reading', error: null, category: null, severity: null },
      toCheck: true,
    })
    expect(s).toEqual({ status: 'Reading', tint: 'reading', reason: null })
  })

  it('Reading while the photos are being described', () => {
    expect(state({ interpretation: { photos: { status: 'interpreting' } } }).status).toBe('Reading')
  })

  it('Transcription failed beats a failed suggestion', () => {
    const s = state({
      recordings: [done, { status: 'failed' }],
      suggestion: { status: 'failed', error: 'x', category: null, severity: null },
      toCheck: true,
    })
    expect(s.status).toBe('Transcription failed')
  })

  it('Reading failed is red with its reason', () => {
    const s = state({
      cats: [],
      sev: '',
      suggestion: { status: 'failed', error: 'Gave up', category: null, severity: null },
      toCheck: true,
    })
    expect(s).toEqual({ status: 'Reading failed', tint: 'failed', reason: 'Suggestion failed' })
  })

  it('To check is amber and names what to check', () => {
    const sev = {
      status: 'done' as const,
      error: null,
      category: null,
      severity: { notSure: true },
    }
    expect(state({ suggestion: sev, toCheck: true })).toEqual({
      status: 'To check',
      tint: 'unsure',
      reason: 'Check severity',
    })
    const cat = { ...sev, category: { notSure: true }, severity: null }
    expect(state({ suggestion: cat, toCheck: true }).reason).toBe('Check category')
    const both = { ...sev, category: { notSure: true } }
    expect(state({ suggestion: both, toCheck: true }).reason).toBe('Check category and severity')
  })

  it('an empty field is to check even with nothing suggested', () => {
    expect(state({ cats: [], sev: '', toCheck: true }).reason).toBe('Choose category and severity')
    expect(state({ sev: '', toCheck: true }).reason).toBe('Choose severity')
  })

  it('an old observation with leftover reading fields never shows Reading', () => {
    // The gateway no longer sends the category half, so only photos or a suggestion can read.
    expect(state({ interpretation: null, suggestion: null }).status).toBe('Complete')
  })
})

describe('the To check filter and count', () => {
  const failed = state({
    toCheck: true,
    suggestion: { status: 'failed', error: null, category: null, severity: null },
  })
  it('matches a failed-suggestion row although its status says Reading failed', () => {
    const o = { status: failed.status, toCheck: true }
    expect(matchesStatus(o, 'To check')).toBe(true)
    expect(matchesStatus(o, 'Reading failed')).toBe(true)
  })

  it('leaves out rows that are still Transcribing or Reading', () => {
    expect(inToCheck({ status: 'Transcribing', toCheck: true })).toBe(false)
    expect(inToCheck({ status: 'Reading', toCheck: true })).toBe(false)
    expect(inToCheck({ status: 'To check', toCheck: true })).toBe(true)
    expect(inToCheck({ status: 'Complete', toCheck: false })).toBe(false)
  })

  it('counts what the filter shows', () => {
    const rows = [
      { status: 'To check', toCheck: true },
      { status: 'Reading failed', toCheck: true },
      { status: 'Reading', toCheck: true },
      { status: 'Complete', toCheck: false },
    ]
    expect(toCheckCount(rows)).toBe(2)
  })

  it('other statuses filter by equality', () => {
    expect(matchesStatus({ status: 'Complete' }, 'Complete')).toBe(true)
    expect(matchesStatus({ status: 'Complete' }, 'Reading')).toBe(false)
  })
})
