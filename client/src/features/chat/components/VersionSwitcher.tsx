// The "‹ 2/3 ›" control under a message that has other versions (CB-04). Used by
// UserMessage.tsx and AnswerBar.tsx.
import type { Versions } from '../api'
import { IconButton } from '../../../design-system'

/** Shows which version is on screen and steps to the one before or after. */
export function VersionSwitcher({
  info,
  label,
  onPick,
}: {
  info: Versions[string]
  label: string
  onPick: (id: string) => void
}) {
  const { ids, index } = info
  return (
    <span className="version-switcher" role="group" aria-label={`${label} versions`}>
      <IconButton
        icon="chevron-left"
        size="sm"
        label={`Previous ${label}`}
        disabled={index === 0}
        onClick={() => onPick(ids[index - 1])}
      />
      <span className="version-switcher__count" aria-live="polite">
        {index + 1}/{ids.length}
      </span>
      <IconButton
        icon="chevron-right"
        size="sm"
        label={`Next ${label}`}
        disabled={index === ids.length - 1}
        onClick={() => onPick(ids[index + 1])}
      />
    </span>
  )
}
