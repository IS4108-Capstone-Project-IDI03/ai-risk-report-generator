// MarshBot's rail beside the thread (AS-06 canvas P6, 284 px): MarshBot's face, its name with the
// status pill under it, the eight stages packed, "At a Glance" in the height left, and the client
// card pinned at the foot. It never scrolls. Called by screens/MarshBotOverview.tsx above 767 px.
import type { AssistantThread } from '../types'
import { BotStatus } from './BotStatus'
import { ClientCard } from './ClientCard'
import { Glance } from './Glance'
import { MarshBotFace } from './MarshBotFace'
import { StageRail } from './StageRail'

/** Returns the rail; the client card opens the assessment's Details. */
export function Rail({
  thread,
  openDetails,
}: {
  thread: AssistantThread
  openDetails: () => void
}) {
  return (
    <aside className="mb-rail" aria-label="MarshBot and stages">
      {/* The rail is a size container; this column inside it tightens as the height runs out
          (marshbot.css), so nothing ever scrolls or overlaps. */}
      <div className="mb-rail-in">
        <div className="mb-bot">
          <span className="mb-face">
            <MarshBotFace mood={thread.mood} />
          </span>
          <div className="mb-bot-id">
            <b>MarshBot</b>
            <BotStatus status={thread.status} />
          </div>
        </div>
        <StageRail thread={thread} />
        <Glance facts={thread.glance} />
        <ClientCard
          name={thread.client.name}
          reference={thread.client.reference}
          onOpen={openDetails}
        />
      </div>
    </aside>
  )
}
