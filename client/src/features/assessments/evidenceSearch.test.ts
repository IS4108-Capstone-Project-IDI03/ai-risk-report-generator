import { describe, expect, it } from 'vitest'
import { andList, hasHit, hitRanges, matchesAll, searchWords } from './evidenceSearch'

// Searching evidence text (CP-13): every word, in any order, ignoring case
// and accents, with where each was found.

describe('searchWords', () => {
  it('splits a search into its words, lowercased and without accents, each once', () => {
    expect(searchWords('  Valve   CAFÉ valve ')).toEqual(['valve', 'cafe'])
    expect(searchWords('')).toEqual([])
    expect(searchWords('   ')).toEqual([])
  })
})

describe('matchesAll', () => {
  it('matches when every word is somewhere in the texts, in any order', () => {
    expect(matchesAll(['Valve V-12 chained open.'], searchWords('open valve'))).toBe(true)
    expect(matchesAll(['Valve V-12 chained open.'], searchWords('valve shut'))).toBe(false)
  })

  it('takes the texts together, and leaves out none given', () => {
    const texts = ['Forklift parked in the aisle.', null, 'Sprinkler valve chained shut.']
    expect(matchesAll(texts, searchWords('forklift sprinkler'))).toBe(true)
    // A word does not run across two texts.
    expect(matchesAll(['shut', 'off'], searchWords('shutoff'))).toBe(false)
  })

  it('ignores case and accents on either side', () => {
    expect(matchesAll(['Le café est fermé'], searchWords('CAFE FERME'))).toBe(true)
    expect(matchesAll(['Le cafe est ferme'], searchWords('café'))).toBe(true)
  })

  it('matches everything for a blank search', () => {
    expect(matchesAll([], [])).toBe(true)
  })
})

describe('hitRanges', () => {
  it('finds every place each word is, in the text as written', () => {
    const text = 'Valve V-12; second valve fine.'
    expect(hitRanges(text, searchWords('valve'))).toEqual([
      [0, 5],
      [19, 24],
    ])
  })

  it('joins overlapping finds, so one mark covers them', () => {
    expect(hitRanges('chained', searchWords('chain ained'))).toEqual([[0, 7]])
  })

  it('keeps positions in the text as written where an accent was dropped', () => {
    const text = 'Café door'
    const [[start, end]] = hitRanges(text, searchWords('door'))
    expect(text.slice(start, end)).toBe('door')
    expect(hitRanges('Fermé', searchWords('ferme'))).toEqual([[0, 5]])
  })

  it('finds nothing for a blank search or text', () => {
    expect(hitRanges('Valve', [])).toEqual([])
    expect(hitRanges('', ['valve'])).toEqual([])
  })
})

describe('hasHit and andList', () => {
  it('says whether any word is in a text', () => {
    expect(hasHit('Valve V-12', ['v-12', 'shut'])).toBe(true)
    expect(hasHit('Valve V-12', ['shut'])).toBe(false)
    expect(hasHit(null, ['valve'])).toBe(false)
  })

  it('names one, two or more things', () => {
    expect(andList(['the note'])).toBe('the note')
    expect(andList(['the note', 'Recording 2'])).toBe('the note and Recording 2')
    expect(andList(['the note', 'Page 1', 'Recording 2'])).toBe('the note, Page 1 and Recording 2')
  })
})
