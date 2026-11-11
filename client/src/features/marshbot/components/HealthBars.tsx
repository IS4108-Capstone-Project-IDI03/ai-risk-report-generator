// The checklist by area (AS-06 board 01): one segment per checklist item, green when covered,
// grey when not, the covered ones amber in a thin area (listed first), "N of M", and a chevron
// that opens the checklist on that area. Data, so it never fills or slides in (board 12).
// Rendered by the HealthBars part (library.tsx).
import { IconButton } from '../../../design-system'
import { useMarshBot } from '../context'

// Past this many items an area gets one filled bar instead of segments: on a phone's 80 px
// bar, 16 segments with their 3 px gaps are the most that fit.
const MAX_SEGMENTS = 16

/** Returns a bar per area named in `areas` (every area when empty); nothing if none match. */
export function HealthBars({ areas }: { areas?: string[] }) {
  const bot = useMarshBot()
  const wanted = areas?.length ? new Set(areas) : null
  const rows = bot.brief.areas
    .filter((a) => !wanted || wanted.has(a.area))
    // Thin first, the rest as the checklist orders them (a stable sort keeps that order).
    .sort((a, b) => Number(b.thin) - Number(a.thin))
  if (!rows.length) return null
  return (
    <div className="mb-panel mb-health">
      {rows.map((a) => (
        <div key={a.area} className="mb-health-row" data-thin={a.thin || undefined}>
          <span className="mb-health-area">{a.area}</span>
          <span
            className="mb-segs"
            data-fill={a.total > MAX_SEGMENTS || undefined}
            role="img"
            aria-label={`${a.area}: ${a.covered} of ${a.total} checklist items covered`}
          >
            {a.total > MAX_SEGMENTS ? (
              <i data-on style={{ width: `${(a.covered / a.total) * 100}%` }} />
            ) : (
              Array.from({ length: a.total }, (_, i) => (
                <i key={i} data-on={i < a.covered || undefined} />
              ))
            )}
          </span>
          <span className="mb-health-count" aria-hidden="true">{`${a.covered} of ${a.total}`}</span>
          <IconButton
            icon="chevron-right"
            label={`Open ${a.area} in the checklist`}
            tooltip="Open in checklist"
            size="lg"
            className="mb-row-icon"
            onClick={() => bot.openLink({ tab: 'checklist', params: { area: a.area } })}
          />
        </div>
      ))}
    </div>
  )
}
