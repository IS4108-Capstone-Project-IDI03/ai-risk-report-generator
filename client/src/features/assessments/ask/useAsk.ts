import { useCallback, useEffect, useRef, useState } from 'react'
import type { Reason } from '../../../design-system'
import { GatewayError, type ReviewWorkspace } from '../api'
import {
  applyProposal,
  askQuestion,
  AskRefusedError,
  deleteConversation,
  listQuestions,
  openConversation,
  ProposalRefusedError,
  type AskAnswer,
  type AskConversation,
  type AskEvent,
  type AskScope,
  type Proposal,
  type ProposalAction,
  type ProposeRequest,
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
  // A request for text for a section (AS-04), shown as proposed text while
  // it is written, before its proposal arrives; null for a question.
  requested: ProposeRequest | null
  // Why the last Insert, Replace or Undo on it was refused, and whether the
  // section changed since it was proposed (AC6): it is then drafted again.
  refusal: (ShownFailure & { stale: boolean }) | null
}

// Why nothing can be asked on an archived assessment (AS-03 AC5): its
// conversations are only read. Shown on Ask about this (AS-02).
export const READ_ONLY: Reason = {
  title: 'Read only',
  text: 'This assessment is archived. Restore it to ask about it again.',
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
  const proposal = answer.proposal ?? null
  return {
    ...answer,
    proposal,
    key,
    step: null,
    failure: answer.error ? { cause: answer.error.cause, at: answer.error.at, next: NEXT } : null,
    requested: proposal
      ? proposal.kind === 'draft'
        ? { kind: 'draft', sectionId: proposal.sectionId }
        : { kind: 'rewrite' }
      : null,
    refusal: null,
  }
}

// Why a conversation could not be opened or deleted, with the next step.
function problemOf(error: unknown, doing: 'opened' | 'deleted'): string {
  if (error instanceof GatewayError && error.status === null)
    return `The conversation could not be ${doing}: the gateway could not be reached. Try again.`
  if (error instanceof GatewayError && error.status === 404)
    return `The conversation could not be ${doing}: it was deleted. Reload the page.`
  if (error instanceof GatewayError && error.status === 409)
    return `The conversation could not be ${doing}: the assessment is archived, so its conversations are read only.`
  return `The conversation could not be ${doing}. Try again.`
}

// The Ask tab's state for one assessment (AS-01): this user's conversations
// about it (AS-03), read once when the workspace opens, which opens on the
// latest; the questions and answers of the one on screen; and the question
// being answered. `conversation` is null for a new conversation, saved with
// its first question. `archived` makes them read only (AS-03 AC5).
// `available` is false without the gateway (AC7): the tab then says why. Kept
// by the review workspace, so an answer keeps streaming while the engineer
// moves between sections, and into the document editor. `about` is the
// passage chosen with "Ask about this" (AS-02), asked about with the next
// question; or, chosen with "Rewrite this" (`rewriting`, AS-04), the passage
// the next request rewrites. `apply` inserts, replaces or undoes proposed text.
export function useAsk(reference: string, enabled: boolean) {
  const [items, setItems] = useState<AskItem[]>([])
  const [scope, setScope] = useState<AskScope | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [reason, setReason] = useState<string | null>(null)
  const running = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [about, setPassage] = useState<AskPassage | null>(null)
  const [rewriting, setRewriting] = useState(false)
  // A passage to ask about (AS-02), or to rewrite (AS-04).
  const setAbout = useCallback((passage: AskPassage | null) => {
    setPassage(passage)
    setRewriting(false)
  }, [])
  const rewrite = useCallback((passage: AskPassage) => {
    setPassage(passage)
    setRewriting(true)
  }, [])
  // The proposed text being inserted, replaced or undone, by its item's key.
  const [applying, setApplying] = useState<string | null>(null)
  const [archived, setArchived] = useState(false)
  const [conversations, setConversations] = useState<AskConversation[]>([])
  const [conversation, setConversation] = useState<AskConversation | null>(null)
  // The conversation on screen, for a question asked before React re-renders.
  const current = useRef<string | null>(null)
  // A conversation being opened from the picker, and why one could not be.
  const opening = useRef<AbortController | null>(null)
  const [switching, setSwitching] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const show = useCallback((next: AskConversation | null, questions: AskAnswer[]) => {
    current.current = next?.id ?? null
    setConversation(next)
    setItems(questions.map((answer) => shown(answer)))
  }, [])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    listQuestions(reference, controller.signal).then(
      (list) => {
        setScope(list.scope)
        setArchived(list.archived)
        setConversations(list.conversations)
        show(list.conversation, list.questions)
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
  }, [reference, enabled, show])

  // Stops the answer being written, and a conversation being opened, when
  // the workspace closes.
  useEffect(() => {
    const answer = running
    const loading = opening
    return () => {
      answer.current?.abort()
      loading.current?.abort()
    }
  }, [])

  // Opens one of the user's conversations, picked in the tab (AS-03 AC2).
  // Not while an answer is written: it belongs to the one on screen.
  const open = useCallback(
    async (id: string) => {
      if (running.current || id === current.current) return
      opening.current?.abort()
      const controller = new AbortController()
      opening.current = controller
      setSwitching(true)
      setProblem(null)
      try {
        const found = await openConversation(reference, id, controller.signal)
        if (controller.signal.aborted) return
        show(found.conversation, found.questions)
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        setProblem(problemOf(error, 'opened'))
      }
      opening.current = null
      setSwitching(false)
    },
    [reference, show],
  )

  // New conversation (AS-03 AC2): the tab empties, and the next question
  // starts another conversation. Nothing is saved until then.
  const startNew = useCallback(() => {
    if (running.current) return
    opening.current?.abort()
    opening.current = null
    setSwitching(false)
    setProblem(null)
    show(null, [])
  }, [show])

  // Deletes a conversation for good (AS-03 AC2), once the engineer confirmed.
  // Throws the reason it was not, for the confirmation to show. The latest
  // left opens in its place, or a new one once none is left.
  const remove = useCallback(
    async (id: string) => {
      if (running.current) return
      try {
        await deleteConversation(reference, id)
      } catch (error: unknown) {
        // Already gone (deleted in another tab): it leaves the list as well.
        if (!(error instanceof GatewayError && error.status === 404))
          throw new Error(problemOf(error, 'deleted'), { cause: error })
      }
      const left = conversations.filter((c) => c.id !== id)
      setConversations(left)
      if (current.current !== id) return
      show(null, [])
      const [latest] = left
      if (latest) await open(latest.id)
    },
    [reference, conversations, open, show],
  )

  const ask = useCallback(
    async (
      question: string,
      passage: AskPassage | null = null,
      propose: ProposeRequest | null = null,
    ) => {
      if (running.current || opening.current) return
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
          proposal: null,
          requested: propose,
          refusal: null,
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
          // The conversation it went into: a new one now has its id and name,
          // and is listed first as the latest (AS-03 AC2).
          const saved = event.conversation
          if (saved) {
            current.current = saved.id
            setConversation(saved)
            setConversations((list) => [saved, ...list.filter((c) => c.id !== saved.id)])
          }
        } else if (event.type === 'step') {
          const step = event.step === 'generate' ? 'generate' : 'retrieve'
          update((item) => ({ ...item, step }))
        } else if (event.type === 'statement') {
          const statement = {
            text: event.text,
            citations: event.citations,
            ...(event.differs && { differs: true }),
            ...(typeof event.supported === 'boolean' && { supported: event.supported }),
            ...(typeof event.paragraph === 'number' && { paragraph: event.paragraph }),
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
        await askQuestion(
          reference,
          question,
          onEvent,
          controller.signal,
          passage,
          current.current,
          propose,
        )
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

  // Inserts, replaces or undoes an item's proposed text (AS-04): the item
  // shows the proposal as it now stands, which is returned with the review
  // workspace holding the section's new version, for the caller to show. A
  // refusal is shown on the item with its cause and next step, and returns null.
  const apply = useCallback(
    async (
      item: AskItem,
      action: Extract<ProposalAction, 'insert' | 'replace' | 'undo'>,
      subsection?: number,
    ): Promise<{ workspace: ReviewWorkspace; proposal: Proposal } | null> => {
      if (!item.proposal) return null
      setApplying(item.key)
      const update = (change: Partial<AskItem>) =>
        setItems((list) => list.map((i) => (i.key === item.key ? { ...i, ...change } : i)))
      update({ refusal: null })
      try {
        const done = await applyProposal(
          reference,
          item.proposal.id,
          action,
          subsection === undefined ? {} : { subsection },
        )
        update({ proposal: done.proposal })
        return done
      } catch (error: unknown) {
        const at = new Date().toISOString()
        update({
          refusal:
            error instanceof ProposalRefusedError
              ? {
                  cause: error.reason,
                  next: error.next,
                  at: error.at,
                  stale: error.code === 'stale',
                }
              : error instanceof GatewayError && error.status === null
                ? {
                    cause: 'the gateway could not be reached',
                    next: 'Try again.',
                    at,
                    stale: false,
                  }
                : error instanceof GatewayError && error.status === 403
                  ? {
                      cause: 'only the assigned engineer can put text into this report',
                      next: 'Ask the assigned engineer.',
                      at,
                      stale: false,
                    }
                  : {
                      cause: 'the gateway refused it',
                      next: 'Reload the page and try again.',
                      at,
                      stale: false,
                    },
        })
        return null
      } finally {
        setApplying(null)
      }
    },
    [reference],
  )

  // A proposal as it now stands after a decision made outside the tab (Accept
  // or Delete on its text in the section, AS-04), on the items showing it.
  const refreshProposal = useCallback((proposal: Proposal) => {
    setItems((list) =>
      list.map((i) => (i.proposal?.id === proposal.id ? { ...i, proposal, refusal: null } : i)),
    )
  }, [])

  // Drafts an item's text again (AS-04 AC6): the same request, on the
  // section as it is now, as a new item.
  const redraft = useCallback(
    (item: AskItem) => {
      if (item.requested) void ask(item.question, item.passage ?? null, item.requested)
    },
    [ask],
  )

  return {
    items,
    scope,
    state,
    reason,
    busy,
    ask,
    stop,
    about,
    setAbout,
    rewriting,
    rewrite,
    apply,
    applying,
    redraft,
    refreshProposal,
    archived,
    conversations,
    conversation,
    switching,
    problem,
    open,
    startNew,
    remove,
  }
}

export type AskWorkflow = ReturnType<typeof useAsk>
