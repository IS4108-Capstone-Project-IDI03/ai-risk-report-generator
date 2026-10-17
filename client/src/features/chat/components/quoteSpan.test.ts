// Table test for the quote locator (CB-02 AC1, AC2): the three match tiers and the miss.
import { describe, expect, it } from 'vitest'
import { markItems, quoteSpan } from './quoteSpan'

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

describe('markItems', () => {
  it('marks only the part of each text item inside the span, escaping HTML', () => {
    // Items joined with one space: "ab <c" + " " + "de f" -> quote "<c de" spans both.
    const mark = markItems(['ab <c', 'de f'], [3, 8])
    expect(mark(0)).toBe('ab <mark>&lt;c</mark>')
    expect(mark(1)).toBe('<mark>de</mark> f')
  })
  it('leaves an item outside the span as escaped plain text', () => {
    expect(markItems(['a&b', 'cd'], [4, 6])(0)).toBe('a&amp;b')
  })
})
