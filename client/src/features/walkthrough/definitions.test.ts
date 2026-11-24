// Checks every walkthrough definition against the screens it points at (F-12, test seam 5).
// A restyle that drops a `data-walk` tag, or a definition that names a tag nobody wrote, fails
// here instead of ending a walkthrough with "I can't find that" in front of a user.
// Reads the client source as text through Vite's glob. Calls registry.ts.
import { describe, expect, it } from 'vitest'
import { DEFINITIONS, GROUPS } from './registry'
import type { StepDef, WalkthroughDef } from './types'

// Every client source file as text, minus the definitions themselves and the tests: a tag must
// be written on a screen, not only named by the walkthrough that wants it.
const files = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const source = Object.entries(files)
  .filter(([path]) => !/walkthroughs\.ts$|\.test\.tsx?$|testDefinitions\.ts$/.test(path))
  .map(([, text]) => text as string)
  .join('\n')

// Tags built from a template, so the full tag is never written out in the source: the shared
// SideNav tags each item `nav.<value>` and each group `nav.group.<heading>` (SideNav.tsx).
const TEMPLATED = [/^nav\.group\.[a-z-]+$/, /^nav\.[a-z-]+$/]

/** Returns every tag a step names: its target, its actions and what it opens first. */
function tagsOf(step: StepDef): string[] {
  const actions = (step.do ?? []).map((a) => ('press' in a ? a.press : a.at))
  return (
    [step.target ?? [], actions, step.open ?? []]
      .flat()
      .filter((t): t is string => !!t)
      // "tag?" is lit only where it is on the screen (types.ts); the tag itself must still exist.
      .map((t) => t.replace(/\?$/, ''))
  )
}

/** Returns every message a walkthrough can say, for both roles. */
function wordsOf(def: WalkthroughDef): string[] {
  const steps = def.steps.flatMap((s) => [s.say, s.sayAdmin])
  return [def.offer, def.otherWay?.say, ...steps].filter((t): t is string => !!t)
}

describe('the walkthrough definitions', () => {
  it('holds all 35, each with a name, a known group and a role', () => {
    expect(DEFINITIONS).toHaveLength(35)
    expect(new Set(DEFINITIONS.map((d) => d.id)).size).toBe(35)
    for (const def of DEFINITIONS) {
      expect(def.name, def.id).toBeTruthy()
      expect(GROUPS, def.id).toContain(def.group)
      expect(def.roles.length, def.id).toBeGreaterThan(0)
      expect(def.steps.length, def.id).toBeGreaterThan(0)
    }
  })

  it('names only tags that a screen really carries', () => {
    const missing = DEFINITIONS.flatMap((def) =>
      [...def.steps.flatMap(tagsOf), ...(def.place.open ?? [])]
        .filter((tag) => !TEMPLATED.some((t) => t.test(tag)))
        // The tag as a quoted string: `data-walk="x"`, `walk="x"` and `walk: 'x'` all hold it.
        .filter((tag) => !source.includes(`"${tag}"`) && !source.includes(`'${tag}'`))
        .map((tag) => `${def.id}: ${tag}`),
    )
    expect(missing).toEqual([])
  })

  it('gives every step that is not a card something to point at', () => {
    const bare = DEFINITIONS.flatMap((def) =>
      def.steps.filter((s) => !s.card && !s.target).map((s) => `${def.id}: ${s.say.slice(0, 40)}`),
    )
    expect(bare).toEqual([])
  })

  // Jesper's rule: a closing question is its own last paragraph, so the call to action stands out.
  it('puts a closing question in its own paragraph', () => {
    const wrong = DEFINITIONS.flatMap((def) =>
      wordsOf(def)
        .filter((text) => text.trim().endsWith('?') && /[.!?]\s/.test(text.trim()))
        .filter((text) => /[.!]\s/.test(text.trim().split('\n\n').at(-1) ?? ''))
        .map((text) => `${def.id}: ${text.slice(-60)}`),
    )
    expect(wrong).toEqual([])
  })

  it('never plays, opens or offers a walkthrough that does not exist', () => {
    const ids = new Set(DEFINITIONS.map((d) => d.id))
    const named = DEFINITIONS.flatMap((def) => [
      def.otherWay?.id,
      ...def.steps.flatMap((s) =>
        (s.answers ?? [])
          .flatMap((a) => [a.then, a.thenAdmin])
          .map((then) => (typeof then === 'object' && 'play' in then ? then.play : undefined)),
      ),
    ]).filter((id): id is string => !!id)
    expect(named.filter((id) => !ids.has(id))).toEqual([])
  })
})
