// Table test for the quote locator (CB-02 AC1, AC2): the match tiers and the miss.
import { describe, expect, it } from 'vitest'
import { quoteSpan } from './quoteSpan'

const TEXT = 'Valves must be\n  inspected   weekly, and records kept.'

describe('quoteSpan', () => {
  const cases: [string, string, string, string | null][] = [
    ['exact', TEXT, 'records kept', 'records kept'],
    [
      'case and whitespace runs ignored',
      TEXT,
      'valves MUST be inspected weekly',
      'Valves must be\n  inspected   weekly',
    ],
    ['punctuation ignored', TEXT, 'weekly and records', 'weekly, and records'],
    // As quotes.py: an accent written as a separate mark is dropped with the punctuation.
    ['accent mark ignored', 'Cafe\u0301 sprinklers.', 'cafe sprinklers', 'Cafe\u0301 sprinklers'],
    ['not found', TEXT, 'monthly', null],
    ['empty quote', TEXT, '   ', null],
    ['punctuation-only quote', TEXT, ',,', null],
  ]
  it.each(cases)('%s', (_name, text, quote, expected) => {
    const span = quoteSpan(quote, text)
    expect(span && text.slice(span[0], span[1])).toBe(expected)
  })
})

describe('quoteSpan across PDF line breaks', () => {
  // pdf.js drops the hyphen of a word split over two lines, and the items are joined with a
  // space, so "measurement" reads "measure ment".
  const PAGE = 'A test performed by the flow and measure ment of water from one hydrant'
  it('finds a quote whose word was split over two lines', () => {
    const span = quoteSpan('the flow and measurement of water', PAGE, { acrossLineBreaks: true })
    expect(span && PAGE.slice(span[0], span[1])).toBe('the flow and measure ment of water')
  })
  it('stays strict without the option, as the server does', () => {
    expect(quoteSpan('the flow and measurement of water', PAGE)).toBeNull()
  })
})
