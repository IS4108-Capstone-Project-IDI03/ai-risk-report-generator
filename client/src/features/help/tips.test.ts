// F-13 test seam 2: the tips' data. Every tip has a label, roles and (if new) text, and every
// Show me names one of the 35 walkthroughs.
import { describe, expect, it } from 'vitest'
import { TIPS, type TipDef } from './tips'

// The 35 ids of F-12's walkthroughs.json, copied here because that file is not in the repo.
const WALKTHROUGH_IDS = [
  'welcome',
  'assessments',
  'new-choice',
  'new-form',
  'new-docs',
  'overview',
  'checklist',
  'observations',
  'new-observation',
  'site-walk',
  'proposal',
  'proposals-list',
  'generation',
  'review',
  'review-ofi',
  'review-scores',
  'ask',
  'document',
  'versions',
  'export',
  'inbox',
  'calendar',
  'clients',
  'client-page',
  'insights',
  'chat',
  'kb-engineer',
  'usage',
  'settings',
  'admin-view',
  'kb-admin',
  'kb-add',
  'kb-review',
  'kb-requests',
  'accounts',
]
// The 7 tips that exist today: their words stay as markup on their own screens, so no `text`.
const EXISTING = [
  'assessments.focus',
  'new-assessment.type',
  'new-assessment.save-email',
  'overview.cards',
  'new-observation.capture',
  'site-walk.recorder',
  'site-walk.proposal',
]
const tips = Object.entries(TIPS) as [string, TipDef][]

describe('help tips data', () => {
  it('has the 53 tips, 7 of them existing', () => {
    expect(tips).toHaveLength(53)
    expect(tips.filter(([, t]) => t.text === undefined).map(([id]) => id)).toEqual(EXISTING)
  })

  it.each(tips)('%s has a label, a role and its words', (id, tip) => {
    expect(tip.label.trim()).not.toBe('')
    expect(tip.roles.length).toBeGreaterThan(0)
    if (!EXISTING.includes(id)) expect(tip.text?.trim()).toBeTruthy()
  })

  it('names only walkthroughs that exist', () => {
    for (const [, tip] of tips)
      if (tip.walkthrough) expect(WALKTHROUGH_IDS).toContain(tip.walkthrough)
  })

  // Needs the registry's definitions (F-12's per-feature walkthroughs.ts files, written later):
  // for each tip with a walkthrough, DEFINITIONS must hold it for every role in tip.roles.
  it.todo('every walkthrough a tip names is playable by each role the tip is shown to')
})
