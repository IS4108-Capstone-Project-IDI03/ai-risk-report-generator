// MarshBot's status pill (AS-06 canvas P6, the earlier boards' `.mood`): an icon and a few words
// on its own row under MarshBot's name, coloured by what it means (red fix first, amber needs
// you, green done, blue waiting): the design system's Badge. One line on the phone bar; up to two
// in the rail. Used by Rail.tsx and PhoneStageBar.tsx.
import { Badge } from '../../../design-system'
import type { AssistantThread } from '../types'

/** Returns the status pill. */
export function BotStatus({ status }: { status: AssistantThread['status'] }) {
  return (
    // The title shows the whole status where a long one ends in "…".
    <Badge tone={status.tone} icon={status.icon} className="mb-status" title={status.text}>
      <span>{status.text}</span>
    </Badge>
  )
}
