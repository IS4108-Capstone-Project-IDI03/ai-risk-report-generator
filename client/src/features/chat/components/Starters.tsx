// Starter questions on an empty chat (CB-01 AC13), as the Overview's reply pills under MarshBot's
// greeting. Drawn by screens/KnowledgeAssistant.tsx inside AgentInterface.Welcome, so pressing
// one asks it in OpenUI's chat like a typed question.
import { useThread } from '@openuidev/react-headless'
import { ReplyButton } from '../../../design-system'
import { starters } from '../starters'

/** Returns the starter pills; the first carries the walkthrough's tag (F-12). */
export function Starters() {
  const processMessage = useThread((s) => s.processMessage)
  // A second question while a reply is still being written would run over it.
  const isRunning = useThread((s) => s.isRunning)
  return (
    <div className="chat-starters" role="group" aria-label="Questions to start with">
      {starters.map((s, i) => (
        <ReplyButton
          key={s.prompt}
          reply={{ label: s.displayText, icon: s.icon }}
          walk={i === 0 ? 'chat.starter-1' : undefined}
          onClick={() => !isRunning && void processMessage({ role: 'user', content: s.prompt })}
        />
      ))}
    </div>
  )
}
