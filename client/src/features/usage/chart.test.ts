// Turning the cost report's groups into stacked-bar data (EV-04). Pure: no DOM.
import { describe, expect, it } from 'vitest'
import { seriesColor, toStackedSeries, type CostGroup } from './chart'

const group = (key: string, over: Partial<CostGroup> = {}): CostGroup => ({
  key,
  label: key,
  estimatedCostUsd: 0,
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  segments: {},
  ...over,
})

const A = group('RPT-A', {
  estimatedCostUsd: 0.6,
  lastActivityAt: '2026-10-05T00:00:00.000Z',
  segments: { anthropic: 0.5, 'cohere-embed': 0.1 },
})
const B = group('RPT-B', {
  estimatedCostUsd: 2,
  lastActivityAt: '2026-10-02T00:00:00.000Z',
  segments: { anthropic: 2 },
})
const C = group('RPT-C', {
  estimatedCostUsd: 0.3,
  lastActivityAt: '2026-10-09T00:00:00.000Z',
  segments: { 'gemini-vision': 0.3 },
})

describe('toStackedSeries', () => {
  it('keeps the order given when asked, as for days in date order', () => {
    expect(toStackedSeries([A, B, C], { sort: 'given', limit: 15 }).bars.map((b) => b.key)).toEqual(
      ['RPT-A', 'RPT-B', 'RPT-C'],
    )
  })

  it('puts the costliest first, or the most recently used when sorted by time', () => {
    expect(toStackedSeries([A, B, C], { sort: 'cost', limit: 15 }).bars.map((b) => b.key)).toEqual([
      'RPT-B',
      'RPT-A',
      'RPT-C',
    ])
    expect(toStackedSeries([A, B, C], { sort: 'time', limit: 15 }).bars.map((b) => b.key)).toEqual([
      'RPT-C',
      'RPT-A',
      'RPT-B',
    ])
  })

  it('shows only as many bars as chosen, and says how many there are', () => {
    const chart = toStackedSeries([A, B, C], { sort: 'cost', limit: 2 })
    expect(chart.bars.map((b) => b.key)).toEqual(['RPT-B', 'RPT-A'])
    expect(chart).toMatchObject({ shown: 2, total: 3 })
  })

  it('gives each bar its label, total and a value per part', () => {
    const [bar] = toStackedSeries([A], { sort: 'cost', limit: 15 }).bars
    expect(bar).toEqual({
      key: 'RPT-A',
      label: 'RPT-A',
      total: 0.6,
      anthropic: 0.5,
      'cohere-embed': 0.1,
    })
  })

  it('stacks the parts in one fixed vendor order, whatever each costs', () => {
    const chart = toStackedSeries(
      [group('X', { segments: { 'cohere-embed': 9, 'gemini-vision': 1, anthropic: 0.1 } })],
      { sort: 'cost', limit: 15 },
    )
    expect(chart.series.map((s) => s.key)).toEqual(['anthropic', 'gemini-vision', 'cohere-embed'])
  })

  it('names only the parts the bars shown actually draw', () => {
    const chart = toStackedSeries([A, B, C], { sort: 'cost', limit: 2 })
    // C (gemini-vision) is not shown; a part that costs nothing draws nothing.
    expect(chart.series.map((s) => s.key)).toEqual(['anthropic', 'cohere-embed'])
    const free = toStackedSeries([group('X', { segments: { anthropic: 1, 'cohere-embed': 0 } })], {
      sort: 'cost',
      limit: 15,
    })
    expect(free.series.map((s) => s.key)).toEqual(['anthropic'])
  })

  it('keeps each part its own colour when others come and go', () => {
    const all = toStackedSeries([A, B, C], { sort: 'cost', limit: 15 }).series
    const fewer = toStackedSeries([C], { sort: 'cost', limit: 15 }).series
    const colourOf = (series: typeof all, key: string) => series.find((s) => s.key === key)!.color
    expect(colourOf(fewer, 'gemini-vision')).toBe(colourOf(all, 'gemini-vision'))
    expect(colourOf(all, 'anthropic')).toBe('var(--chart-blue)')
  })

  it('names each part for people, and puts a part it does not know last, in a neutral colour', () => {
    const chart = toStackedSeries([group('X', { segments: { 'new-vendor': 1, anthropic: 1 } })], {
      sort: 'cost',
      limit: 15,
    })
    expect(chart.series).toEqual([
      { key: 'anthropic', label: 'Anthropic (Claude)', color: 'var(--chart-blue)' },
      { key: 'new-vendor', label: 'new-vendor', color: 'var(--chart-neutral)' },
    ])
  })
})

describe('seriesColor', () => {
  it('gives every billed service and feature a chart token', () => {
    for (const key of [
      'anthropic',
      'gemini-vision',
      'gemini-ocr',
      'typesafe-jev',
      'openai-whisper',
      'openai-label',
      'cohere-embed',
      'cohere-rerank',
      'self-hosted-ocr',
      'draft-section',
      'retrieval',
      'transcribe',
      'interpret-photo',
      'chat',
      'label-document',
      'ocr',
      'embed-document',
    ])
      expect(seriesColor(key)).toMatch(/^var\(--chart-[a-z-]+\)$/)
  })
})
