// Puts a queued question (askAgain.ts) in the chat box, for the engineer to send. "Ask again" on
// a filled knowledge request (CB-07, notifications/openSubject.ts) queues it.
// Drawn inside AgentInterface (screens/KnowledgeAssistant.tsx).
import { useEffect } from 'react'
import { QUESTION_QUEUED, takeQuestion } from '../askAgain'
import { fillBox } from './fillBox'

/** Fills the chat box with a queued question on opening, or when one is queued later; draws nothing. */
export function QuestionFromLink() {
  useEffect(() => {
    let frame = 0
    const take = () => {
      const question = takeQuestion()
      if (!question) return
      // OpenUI may draw the box a frame or two after this; try for about half a second.
      let tries = 30
      const fill = () => {
        if (!fillBox(question) && --tries > 0) frame = requestAnimationFrame(fill)
      }
      fill()
    }
    take()
    window.addEventListener(QUESTION_QUEUED, take)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener(QUESTION_QUEUED, take)
    }
  }, [])
  return null
}
