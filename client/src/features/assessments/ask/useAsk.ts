import { useCallback, useEffect, useRef, useState } from 'react'
import { GatewayError } from '../api'
import {
  askQuestion,
  AskRefusedError,
  listQuestions,
  type AskAnswer,
  type AskEvent,
  type AskScope,
} from './api'
import type { AskPassage } from './passage'

// A failure as the Ask tab shows it (AC8): its cause and time, and the next step.
export type ShownFailure = { cause: string; at: string; next: string }

// One question in the tab: as saved, or as it is being answered.
export type AskItem = AskAnswer & {
  // Stays the same while the item is on screen: its saved id once known, or
  // the temporary one it was asked under, so its row is never remounted.
  key: string
  // The step being run while it is answered: searching, then writing.
  step: 'retrieve' | 'generate' | null
  failure: ShownFailure | null
}

const NEXT = 'Ask again.'

// A question the gateway refused before answering, as a cause and next step
// (AC8): "Answer stopped at 14:02: <cause>. <next step>"
function refusal(error: GatewayError): [cause: string, next: string] {
  if (error.status === 403)
    return [
      'only the assigned engineer and knowledge admins can ask about this assessment',
      'Ask the assigned engineer or a knowledge admin.',
    ]
  if (error.status === 404) return ['this assessment could not be found', 'Reload the page.']
  if (error.status === 400) return ['the question could not be read', 'Check it and ask again.']
  // The gateway's own words, as part of a sentence: no capital, no full stop.
  const said = error.message.trim().replace(/[.!]+$/, '')
  return [
    said ? said.charAt(0).toLowerCase() + said.slice(1) : 'the gateway refused the question',
    NEXT,
  ]
}

function shown(answer: AskAnswer, key = answer.id): AskItem {
  return {
    ...answer,
    key,
    step: null,
    failure: answer.error ? { cause: answer.error.cause, at: answer.error.at, next: NEXT } : null,
  }
}

// The Ask tab's state for one assessment (AS-01): this user's earlier
// questions and answers, read once when the workspace opens, and the question
// being answered. `available` is false without the gateway (AC7): the tab then
// says why. Kept by the review workspace, so an answer keeps streaming while
// the engineer moves between sections, and into the document editor. `about`
// is the passage chosen with "Ask about this" (AS-02), asked about with the
// next question.
export function useAsk(reference: string, enabled: boolean) {
  const [items, setItems] = useState<AskItem[]>([])
  const [scope, setScope] = useState<AskScope | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [reason, setReason] = useState<string | null>(null)
  const running = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [about, setAbout] = useState<AskPassage | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    listQuestions(reference, controller.signal).then(
      (list) => {
        setScope(list.scope)
        setItems(list.questions.map((answer) => shown(answer)))
        setState('ready')
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState('unavailable')
        setReason(
          error instanceof GatewayError && error.status === null
            ? 'The gateway could not be reached, so nothing can be searched.'
            : error instanceof Error
              ? error.message
              : 'Earlier questions could not be loaded.',
        )
      },
    )
    return () => controller.abort()
  }, [reference, enabled])

  // Stops the answer being written when the workspace closes.
  useEffect(() => {
    const answer = running
    return () => answer.current?.abort()
  }, [])

  const ask = useCallback(
    async (question: string, passage: AskPassage | null = null) => {
      if (running.current) return
      const controller = new AbortController()
      running.current = controller
      setBusy(true)
      const key = `pending-${Date.now()}`
      const update = (change: (item: AskItem) => AskItem) =>
        setItems((list) => list.map((item) => (item.key === key ? change(item) : item)))
      setItems((list) => [
        ...list,
        {
          id: key,
          key,
          question,
          passage,
          askedAt: new Date().toISOString(),
          status: 'answering',
          statements: [],
          missing: [],
          passages: [],
          observations: [],
          confidence: null,
          error: null,
          step: 'retrieve',
          failure: null,
        },
      ])
      const fail = (cause: string, next = NEXT, at = new Date().toISOString()) =>
        update((item) => ({
          ...item,
          status: item.statements.length ? 'stopped' : 'failed',
          step: null,
          failure: { cause, at, next },
        }))
      let finished = false
      const onEvent = (event: AskEvent) => {
        if (event.type === 'question') {
          const id = event.id
          update((item) => ({ ...item, id, askedAt: event.askedAt }))
        } else if (event.type === 'step') {
          const step = event.step === 'generate' ? 'generate' : 'retrieve'
          update((item) => ({ ...item, step }))
        } else if (event.type === 'statement') {
          const statement = {
            text: event.text,
            citations: event.citations,
            ...(event.differs && { differs: true }),
          }
          update((item) => ({
            ...item,
            statements: [...item.statements, statement],
            passages: [...item.passages, ...(event.passages ?? [])],
            observations: [...item.observations, ...(event.observations ?? [])],
          }))
        } else if (event.type === 'missing') {
          update((item) => ({ ...item, missing: [...item.missing, event.text] }))
        } else if (event.type === 'result') {
          finished = true
          update(() => shown(event.answer, key))
        }
      }
      try {
        await askQuestion(reference, question, onEvent, controller.signal, passage)
        if (!finished) fail('the answer ended before it was finished')
      } catch (error: unknown) {
        if (controller.signal.aborted) fail('the answer was stopped before it finished')
        else if (error instanceof AskRefusedError) fail(error.reason, error.next, error.at)
        else if (error instanceof GatewayError && error.status === null)
          fail('the gateway could not be reached')
        else if (error instanceof GatewayError) fail(...refusal(error))
        else fail('the question could not be sent')
      }
      running.current = null
      setBusy(false)
    },
    [reference],
  )

  const stop = useCallback(() => running.current?.abort(), [])

  return { items, scope, state, reason, busy, ask, stop, about, setAbout }
}

export type AskWorkflow = ReturnType<typeof useAsk>
