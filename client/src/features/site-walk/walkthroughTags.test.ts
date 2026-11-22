// F-12: every data-walk tag and signal that the New Observation and site walk walkthroughs name must
// exist in the source (outside the definitions themselves), so a restyle cannot silently break them.
import { describe, expect, it } from 'vitest'
import { SIGNALS } from '../walkthrough/signals'
import { WALKTHROUGHS as observation } from '../assessments/new-observation.walkthroughs'
import { WALKTHROUGHS as siteWalk } from './walkthroughs'
import type { StepDef } from '../walkthrough/types'

const sources = import.meta.glob(
  [
    '../**/*.tsx',
    '../**/*.ts',
    '!../**/*.test.*',
    '!../**/*walkthroughs.ts',
    '!../walkthrough/signals.ts',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>
const all = Object.values(sources).join('\n')

const defs = [...observation, ...siteWalk]
const steps: StepDef[] = defs.flatMap((d) => d.steps)
const tags = new Set(
  steps.flatMap((s) => [
    ...[s.target ?? []].flat().map((t) => t.replace(/\?$/, '')), // a trailing ? marks an optional tag
    ...(s.open ?? []),
    ...(s.do ?? []).flatMap((a) => ('press' in a ? [a.press] : a.at ? [a.at] : [])),
  ]),
)
const signals = new Set([
  ...steps.flatMap((s) => [
    s.wait ?? '',
    ...(s.do ?? []).flatMap((a) => ('signal' in a ? [a.signal] : [])),
  ]),
  ...defs.map((d) => d.otherWay?.after ?? ''),
])
signals.delete('')

describe('walkthrough tags and signals of New Observation and the site walk', () => {
  it.each([...tags])('tag %s is in the source', (tag) => {
    expect(all).toContain(tag)
  })
  it.each([...signals])('signal %s is listed in SIGNALS and raised somewhere', (name) => {
    expect(SIGNALS as readonly string[]).toContain(name)
    expect(all).toContain(`'${name}'`)
  })
})
