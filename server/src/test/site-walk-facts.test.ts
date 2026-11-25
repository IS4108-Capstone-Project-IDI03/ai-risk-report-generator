// MarshBot's site-walk items (AS-06) as Focus and the Overview read them: a
// walk's name is the engineer's own words, so the sentence never starts with it.
import { describe, expect, it } from 'vitest'
import { siteWalks } from '../services/assistant/checks/site-walks'
import type { CheckContext } from '../services/assistant/context'

const walk = (name: string | null, status: string) =>
  ({
    walks: [
      { id: 'w1', name, status, createdAt: new Date('2026-11-25T02:00:00Z'), proposal: null },
    ],
  }) as unknown as CheckContext

describe('Site walk facts', () => {
  it('names a walk inside the sentence, so a plural name still reads right', () => {
    expect(siteWalks(walk('Tower A basements', 'ready'))[0].fact).toBe(
      'The site walk “Tower A basements” is waiting for review.',
    )
    expect(siteWalks(walk(null, 'failed'))[0].fact).toBe("A site walk couldn't be read.")
  })
})
