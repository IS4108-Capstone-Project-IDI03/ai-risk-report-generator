// MarshBot's words, one span per word so each fades in as it is revealed (board 12), like the
// chatbot's letters (features/chat/chat.css .chat-ch). Names the rules wrap in **…** show bold.
// Used by the Say part (library.tsx) and the plain fallback (MessageBody.tsx).
import { useContext } from 'react'
import { RevealContext } from '../context'
import { wordsOf } from '../plan'

/** Returns the paragraph with as many words as the reveal allows. */
export function Words({ text }: { text: string }) {
  const reveal = useContext(RevealContext)
  if (reveal.state === 'hidden') return null
  const all = wordsOf(text)
  const shown = reveal.state === 'partial' ? all.slice(0, reveal.words) : all
  return (
    <p className="mb-say">
      {/* Keyed by place, so words already shown stay and only new ones fade in. */}
      {shown.map((w, i) => (
        <span key={i} className="mb-word">
          {i > 0 && !w.glued && ' '}
          {w.bold ? <strong>{w.text}</strong> : w.text}
        </span>
      ))}
    </p>
  )
}
