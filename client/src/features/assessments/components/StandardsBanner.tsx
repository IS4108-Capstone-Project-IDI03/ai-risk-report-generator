// The Review rail's note on how many drafted sections cite a standard (GN-16 AC5).
// Called by ReviewSectionRail. A warning only: it never disables a button.
import { Icon } from '../../../design-system'
import type { ReviewSection } from '../api'
import { countCitingStandard } from '../citedStandards'

/** Returns the banner, or nothing while no evidence section is drafted. */
export function StandardsBanner({
  sections,
  target,
}: {
  sections: ReviewSection[]
  target: number
}) {
  const { cited, total } = countCitingStandard(sections)
  if (total === 0) return null
  const below = (cited / total) * 100 < target
  return (
    <div
      className={below ? 'st-warn' : 'rv-viewer-note'}
      role="status"
      style={{ margin: '0 18px 12px', flexDirection: 'column', gap: 4 }}
    >
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <Icon
          name={below ? 'triangle-alert' : 'check'}
          size={14}
          color={below ? 'var(--status-moderate-fg)' : 'var(--green-600)'}
        />
        {cited} of {total} sections cite a standard (target {target}%)
      </span>
      {below && <span>Below target. Drafts still go ahead.</span>}
    </div>
  )
}
