// Any stage (AS-06): site walks still open or being read, ready to review
// (Fix now) or failed (Fix now).
import type { CheckContext } from '../context'
import { clockTime } from '../dates'
import { raise, type RaisedItem } from '../item'

/** Returns one item per site walk that isn't created or discarded yet. */
export function siteWalks(ctx: CheckContext): RaisedItem[] {
  return ctx.walks.flatMap((w) => {
    const title = w.name ?? 'Site walk'
    const time = clockTime(new Date(w.createdAt))
    const base = {
      kind: 'site-walks',
      stage: 'capture' as const,
      title,
      icon: 'footprints',
      link: { tab: 'observations' as const, params: { walk: w.id } },
    }
    if (w.status === 'ready') {
      const proposed = w.proposal?.observations.length ?? 0
      return [
        raise({
          ...base,
          id: `walk.ready:${w.id}`,
          weight: 'fix_now',
          detail: `${time} · ${proposed} proposed`,
          fact: `${title} is waiting for review.`,
          facts: { status: w.status, proposed },
        }),
      ]
    }
    if (w.status === 'failed')
      return [
        raise({
          ...base,
          id: `walk.failed:${w.id}`,
          weight: 'fix_now',
          detail: `${time} · Couldn't be read`,
          fact: `${title} couldn't be read.`,
          facts: { status: w.status, error: w.error },
        }),
      ]
    if (w.status === 'recording')
      return [
        raise({
          ...base,
          id: `walk.open:${w.id}`,
          weight: 'info',
          detail: `Started ${time}, still open`,
          fact: `${title} is still open.`,
          facts: { status: w.status },
        }),
      ]
    if (w.status === 'transcribing' || w.status === 'proposing')
      return [
        raise({
          ...base,
          id: `walk.reading:${w.id}`,
          weight: 'info',
          detail: `${time} · Being read`,
          fact: `${title} is being read.`,
          facts: { status: w.status },
        }),
      ]
    return []
  })
}
