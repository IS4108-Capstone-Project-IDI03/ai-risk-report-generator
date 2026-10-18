// Stacked-bar data for the usage and cost charts (EV-04): which bars, in what
// order, and each part's colour. Used by components/StackedCostChart.tsx.
// Colours are tokens from design-system/tokens/colors.css ("Chart series"),
// validated as a set; see docs/design-system.md, "Charts".
import { FEATURE_LABELS, SERVICE_LABELS } from './format'

// One group of the report's overview or ingestion view: an assessment, an
// engineer or a document, with its cost per split key.
export type CostGroup = {
  key: string
  label: string
  estimatedCostUsd: number
  lastActivityAt: string
  segments: Record<string, number>
}

// 'given' keeps the groups' own order, as for days in date order.
export type ChartSort = 'cost' | 'time' | 'given'

// One bar: its key, label, total, and a value per part (split key).
export type Bar = { key: string; label: string; total: number } & Record<string, number | string>
export type Series = { key: string; label: string; color: string }

// The order parts stack in, bottom up: billed services grouped by vendor, then
// features. Fixed, never by cost, so a vendor's two shades always touch and a
// part never changes place or colour when another comes or goes.
const STACK_ORDER = [
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
]

// Each billed service wears its vendor's hue; a vendor billing two services
// gets a dark and a light step, split so the services that share a bar on each
// tab differ in lightness. A feature wears the hue of the vendor that bills it
// most. Report and ingestion features never share a chart, so they reuse hues.
const SERIES_COLORS: Record<string, string> = {
  anthropic: 'blue',
  'gemini-vision': 'aqua-light',
  'gemini-ocr': 'aqua-dark',
  'typesafe-jev': 'olive',
  'openai-whisper': 'magenta-dark',
  'openai-label': 'magenta-light',
  'cohere-embed': 'orange-dark',
  'cohere-rerank': 'orange-light',
  'self-hosted-ocr': 'neutral',
  'draft-section': 'blue',
  retrieval: 'orange-light',
  transcribe: 'magenta-dark',
  'interpret-photo': 'aqua-light',
  chat: 'orange-dark',
  'label-document': 'blue',
  ocr: 'aqua-dark',
  'embed-document': 'orange-dark',
}

/** The chart token for a billed service or feature; neutral for one this screen does not know. */
export function seriesColor(key: string): string {
  return `var(--chart-${SERIES_COLORS[key] ?? 'neutral'})`
}

const seriesLabel = (key: string) => SERVICE_LABELS[key] ?? FEATURE_LABELS[key] ?? key

// Where a part stacks: its place in STACK_ORDER, unknown ones last by name.
const stackRank = (key: string) => {
  const at = STACK_ORDER.indexOf(key)
  return at === -1 ? STACK_ORDER.length : at
}

/**
 * The bars to draw, sorted by cost (costliest first) or time (most recently
 * used first) and cut to `limit`, with the parts those bars draw in stack
 * order. `total` is how many groups there are, so the chart can say how many
 * it leaves to the table below it.
 */
export function toStackedSeries(
  groups: CostGroup[],
  { sort, limit }: { sort: ChartSort; limit: number },
): { bars: Bar[]; series: Series[]; shown: number; total: number } {
  const sorted =
    sort === 'given'
      ? groups
      : [...groups].sort((a, b) =>
          sort === 'cost'
            ? b.estimatedCostUsd - a.estimatedCostUsd || a.key.localeCompare(b.key)
            : b.lastActivityAt.localeCompare(a.lastActivityAt) || a.key.localeCompare(b.key),
        )
  const shown = sorted.slice(0, Math.max(0, limit))
  const bars = shown.map((g): Bar => ({
    key: g.key,
    label: g.label,
    total: g.estimatedCostUsd,
    ...g.segments,
  }))
  // A part that costs nothing in every bar shown draws nothing, so it is not named.
  const drawn = [
    ...new Set(
      shown.flatMap((g) => Object.keys(g.segments).filter((k) => (g.segments[k] ?? 0) > 0)),
    ),
  ]
  const series = drawn
    .sort((a, b) => stackRank(a) - stackRank(b) || a.localeCompare(b))
    .map((key) => ({ key, label: seriesLabel(key), color: seriesColor(key) }))
  return { bars, series, shown: shown.length, total: groups.length }
}
