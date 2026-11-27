// MarshBot's speech bubble (AS-06 canvas C1): white, green for good news, amber for a stand-out
// message; the first of a turn has a tail towards the face. Shared by the Overview's thread
// (features/marshbot/components/thread/Flow.tsx, Alert.tsx) and the knowledge chat's answers
// (features/chat/library.tsx).
import type { ReactNode } from 'react'
import './conversation.css'

/** Returns one speech bubble round `children`. */
export function SpeechBubble({
  tone,
  tail,
  children,
}: {
  tone: 'normal' | 'good' | 'alert'
  tail: boolean
  children: ReactNode
}) {
  return (
    <div className="mbt-bubble mbt-in" data-tone={tone} data-tail={tail || undefined}>
      {children}
    </div>
  )
}
