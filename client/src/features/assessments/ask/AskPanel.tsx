// The Ask tab (AS-01) in the review workspace's inspector, its phone sheet and the document
// editor's Ask panel: a MarshBot conversation drawn with the design system's conversation pieces,
// as the Overview and the knowledge chat are. Each question is the engineer's bubble; each answer,
// proposed text (AS-04) or gap list (AS-08) is a MarshBot turn (components/). Rendered by
// components/ReviewInspector.tsx and DocumentAsk.tsx; the workflow is useAsk.ts.
import { useEffect, useRef, useState } from 'react'
import {
  BotTurn,
  Callout,
  EmptyState,
  EngineerBubble,
  Icon,
  SpeechBubble,
  toast,
  type Reason,
} from '../../../design-system'
import type { ReviewWorkspace } from '../api'
import type { CommentAnchor } from '../comments/api'
import { Tip } from '../../help/Tip'
import { useWalkthroughs } from '../../walkthrough/engine'
import type { AskConversation, GapLink, GuideKind, Proposal } from './api'
import { AnswerTurn } from './components/AnswerTurn'
import { AskComposer } from './components/AskComposer'
import { ConversationBar } from './components/ConversationBar'
import { DeleteConversationDialog } from './components/DeleteConversationDialog'
import { GapListTurn } from './components/GapListTurn'
import { PassageQuote } from './components/PassageQuote'
import { ProposalTurn } from './components/ProposalTurn'
import { WritingGuidance } from './components/WritingGuidance'
import { guideBlocked } from './guidance'
import type { AskPassage } from './passage'
import { templateLink } from './sources'
import type { AskItem, AskWorkflow } from './useAsk'
import './ask.css'

const MAX_QUESTION = 1000

// The question the Ask walkthrough (F-12) types in for the person on its step 2; its words name it.
const WALK_QUESTION = 'Which observations concern fire protection?'

// What the Ask tab may do with proposed text (AS-04), given only to whoever
// may put text into the report (the assigned engineer, AC5): the section
// "Draft text" drafts into, why Insert, Replace and Undo can't be used now,
// and what is shown once they were.
export type AskDrafting = {
  // The section open, if it is one of Sections 4 to 12; else null.
  target: { sectionId: string; label: string } | null
  // e.g. the document editor has unsaved changes.
  blocked?: Reason
  // The review workspace with the section's new version, and the proposal.
  onApplied: (workspace: ReviewWorkspace, proposal: Proposal, item: AskItem) => void
}

// Writing guidance in the Ask tab (AS-08): the part of the report open, which
// the two buttons ask about, and going to where a gap is finished or a cited
// template part sits. Given to anyone who can ask.
export type AskGuidanceTarget = {
  // The part open, as the report heads it; null when none is.
  target: { sectionId: string; label: string } | null
  onGo: (link: GapLink) => void
}

// Why nothing more can be asked while an answer is written (AS-08's buttons).
const ANSWERING_NOW: Reason = {
  title: 'An answer is being written',
  text: 'Wait for it to finish, or stop it, to ask again.',
}

// What a new question searches (AC3), in a sentence.
function scopeLine(ask: AskWorkflow) {
  const scope = ask.scope
  if (!scope)
    return 'Searches this assessment’s observations, its selected standards and matching past reports.'
  const standards = scope.standards.length
  const from =
    scope.standardsFrom === 'checklist' ? ' kept on its checklist' : ' that apply to the site'
  return (
    `Searches its ${scope.observations} observation${scope.observations === 1 ? '' : 's'}, ` +
    `${standards} standard${standards === 1 ? '' : 's'}${standards ? from : ''} and ` +
    `${scope.pastReports} past report${scope.pastReports === 1 ? '' : 's'} on ` +
    `${scope.facilityType} sites in ${scope.jurisdiction}.`
  )
}

// The Ask tab (AS-01): this engineer's questions about the assessment and
// their cited answers, newest last, then the question box. Questions are kept
// in conversations (AS-03): the tab opens on the latest, the picker above
// opens another, starts a new one or deletes one after confirming; on an
// archived assessment they are only read. Without the gateway (`ask` null)
// it says it is unavailable and why (AC7). A
// question about a passage selected in the draft (AS-02) quotes it, in the
// question box and above the question once asked; `locate` says whether its
// text is still there and `onShowPassage` goes back to it. With `drafting`
// (the assigned engineer, AS-04), Draft text asks for text for the open
// section instead of an answer, a passage chosen with Rewrite this is
// rewritten, and proposed text can be inserted, replaced and undone. With
// `guidance` (AS-08), two buttons ask what the open section should cover and
// what is missing from it; a gap's link, or a cited part of the template, goes
// to its place through `guidance.onGo`.
export function AskPanel({
  ask,
  unavailable,
  current,
  onCite,
  autoFocus = false,
  locate,
  onShowPassage,
  drafting,
  guidance,
}: {
  ask: AskWorkflow | null
  unavailable?: string
  current: string | null
  onCite: (ref: string, item: AskItem) => void
  autoFocus?: boolean
  locate?: (anchor: CommentAnchor) => boolean | undefined
  onShowPassage?: (passage: AskPassage) => void
  drafting?: AskDrafting
  guidance?: AskGuidanceTarget
}) {
  const [question, setQuestion] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  // The conversation whose delete is being confirmed (AS-03 AC2).
  const [deleting, setDeleting] = useState<AskConversation | null>(null)
  const thread = useRef<HTMLOListElement>(null)
  // Holds the question box, to focus it: the shared Textarea takes no ref.
  const box = useRef<HTMLDivElement>(null)
  const focusBox = () => box.current?.querySelector('textarea')?.focus()
  const count = ask?.items.length ?? 0
  const last = ask?.items.at(-1)
  const progress = `${count}:${last?.statements.length ?? 0}:${last?.missing.length ?? 0}:${last?.status}`
  // The question box, sticky at the foot of the panel.
  const composer = useRef<HTMLFormElement>(null)
  // Keeps the newest answer in view as it is written. The margin is the sticky
  // question box's height: without it "nearest" parks the answer's end (a
  // stopped answer's Ask again, a card's Insert) behind the box.
  useEffect(() => {
    const item = thread.current?.lastElementChild as HTMLElement | null | undefined
    if (!item) return
    item.style.scrollMarginBottom = `${composer.current?.offsetHeight ?? 0}px`
    item.scrollIntoView?.({ block: 'nearest' })
  }, [progress])
  useEffect(() => {
    if (autoFocus) box.current?.querySelector('textarea')?.focus()
  }, [autoFocus])
  // A passage chosen with Ask about this: the question box is next (AS-02).
  const about = ask?.about ?? null
  useEffect(() => {
    if (about) box.current?.querySelector('textarea')?.focus()
  }, [about])
  // The Ask walkthrough's step 2 (F-12) says it has typed a question in: fill the box when that step
  // shows, only if it is empty. Without the empty check it would overwrite what the person typed.
  const walking = useWalkthroughs((s) => s.running)
  const walkStep = walking?.id === 'ask' ? walking.at : 0
  const [seenWalkStep, setSeenWalkStep] = useState(0)
  if (walkStep !== seenWalkStep) {
    setSeenWalkStep(walkStep)
    if (walkStep === 2) setQuestion((q) => q || WALK_QUESTION)
  }

  if (!ask || ask.state === 'unavailable')
    return (
      <div className="ask-panel">
        <EmptyState
          icon="message-circle-question"
          title="Ask is unavailable"
          description={
            unavailable ?? ask?.reason ?? "This assessment isn't saved, so it can't be asked about."
          }
        />
      </div>
    )

  // A passage chosen with Rewrite this (AS-04), rewritten by the next request.
  const rewriting = !!about && ask.rewriting && !!drafting
  // Asks a question, about `passage` when given: the one in the question box
  // unless asked again.
  const send = (text: string, passage: AskPassage | null = about) => {
    if (ask.switching || ask.archived) return
    if (rewriting && passage === about) {
      draft('rewrite')
      return
    }
    const trimmed = text.trim()
    if (!trimmed) {
      setProblem('Type a question to ask.')
      focusBox()
      return
    }
    if (trimmed.length > MAX_QUESTION) {
      setProblem('Keep the question to 1,000 characters.')
      return
    }
    setProblem(null)
    setQuestion('')
    if (passage && passage === about) ask.setAbout(null)
    void ask.ask(trimmed, passage)
  }
  // Asks for text instead of an answer (AS-04): new text for the open section
  // from the request typed, or a rewrite of the passage in the box (the
  // request then says how, and may be left empty).
  const draft = (kind: 'draft' | 'rewrite') => {
    if (ask.switching || ask.archived || !drafting) return
    const trimmed = question.trim() || (kind === 'rewrite' ? 'Rewrite this passage.' : '')
    if (!trimmed) {
      setProblem('Say what to draft, e.g. a paragraph on flood exposure from the observations.')
      focusBox()
      return
    }
    if (trimmed.length > MAX_QUESTION) {
      setProblem('Keep the request to 1,000 characters.')
      return
    }
    if (kind === 'draft' && !drafting.target) return
    setProblem(null)
    setQuestion('')
    if (kind === 'rewrite') {
      const passage = about
      ask.setAbout(null)
      void ask.ask(trimmed, passage, { kind: 'rewrite' })
    } else void ask.ask(trimmed, null, { kind: 'draft', sectionId: drafting.target!.sectionId })
  }
  // Why Draft text can't be used now.
  const draftBlocked: Reason | undefined = !drafting?.target
    ? {
        title: 'No section open',
        text: 'Open one of Sections 4 to 12 to draft text into it.',
      }
    : about
      ? {
          title: 'A passage is in the box',
          text: 'Remove it to draft new text, or ask about it.',
        }
      : undefined
  // Writing guidance for the part open (AS-08).
  const askGuide = (kind: GuideKind, section = guidance?.target ?? null) => {
    if (ask.switching || ask.archived || ask.busy || !section) return
    if (guideBlocked(kind, section)) return
    setProblem(null)
    void ask.guide(kind, section)
  }
  const guideReason = (kind: GuideKind): Reason | undefined =>
    ask.busy ? ANSWERING_NOW : guideBlocked(kind, guidance?.target ?? null)
  // A citation of the template's part goes to its place in the section (AS-08);
  // any other opens its source.
  const cite = (ref: string, item: AskItem) => {
    if (ref.startsWith('T:') && guidance)
      guidance.onGo(
        templateLink(
          ref,
          item.template?.find((t) => t.id === ref),
        ),
      )
    else onCite(ref, item)
  }
  const passageOf = (item: AskItem) =>
    item.passage && (
      <PassageQuote
        passage={item.passage}
        heading={item.passage.label}
        found={locate?.(item.passage.anchor)}
        onShow={onShowPassage && (() => onShowPassage(item.passage!))}
      />
    )

  return (
    <div className="ask-panel">
      <ConversationBar ask={ask} onDelete={() => setDeleting(ask.conversation)} />
      {ask.problem && (
        <div role="alert">
          <Callout tone="warning" title="Conversation not opened">
            {ask.problem}
          </Callout>
        </div>
      )}
      {/* The conversation: MarshBot's greeting says what a question searches (AC3), then each
          question and its turn. The compact pieces fit the inspector's narrow column. */}
      <div className="ask-convo mbt-convo mbt-compact">
        <BotTurn mood="idle" named>
          <SpeechBubble tone="normal" tail>
            <div className="ask-scope">
              <span data-walk="ask.scope">{scopeLine(ask)}</span> <Tip id="ask.searches" />
            </div>
            {count === 0 && ask.state !== 'loading' && !ask.switching && (
              <p>
                Answers cite the observations, standards and past reports they rest on, and say what
                evidence is missing when there is none.
              </p>
            )}
          </SpeechBubble>
        </BotTurn>
        {ask.state === 'loading' ? (
          <div className="ask-note">Loading earlier questions…</div>
        ) : ask.switching ? (
          <div className="ask-note" role="status">
            Opening the conversation…
          </div>
        ) : (
          count > 0 && (
            <ol ref={thread} className="ask-thread" aria-label="Questions and answers">
              {ask.items.map((item, i) => (
                <li key={item.key} className="ask-item">
                  {passageOf(item)}
                  <EngineerBubble text={item.question} />
                  {item.requested ? (
                    <ProposalTurn
                      item={item}
                      ask={ask}
                      drafting={drafting}
                      current={current}
                      onCite={onCite}
                    />
                  ) : item.guidance?.kind === 'missing' ? (
                    <GapListTurn
                      item={item}
                      onGo={guidance?.onGo}
                      onAskAgain={() => askGuide('missing', item.guidance)}
                      canAsk={!ask.busy && !ask.archived}
                    />
                  ) : (
                    <AnswerTurn
                      item={item}
                      current={current}
                      onCite={cite}
                      onAskAgain={(text, passage) =>
                        item.guidance
                          ? askGuide(item.guidance.kind, item.guidance)
                          : send(text, passage)
                      }
                      canAsk={!ask.busy && !ask.archived}
                      walk={i === count - 1 ? 'ask.answer' : undefined}
                    />
                  )}
                </li>
              ))}
            </ol>
          )
        )}
      </div>
      {ask.archived ? (
        // Read only (AS-03 AC5): the gateway refuses new questions too (409).
        <div className="ask-readonly" role="note">
          <Icon name="archive" size={14} color="var(--text-muted)" />
          <span>
            This assessment is archived, so its conversations are read only. Restore the assessment
            to ask about it again.
          </span>
        </div>
      ) : (
        <>
          {guidance && (
            <WritingGuidance
              label={guidance.target?.label}
              disabled={ask.switching}
              reason={guideReason}
              onAsk={askGuide}
            />
          )}
          <AskComposer
            formRef={composer}
            boxRef={box}
            ask={ask}
            about={about}
            rewriting={rewriting}
            drafting={!!drafting}
            draftBlocked={draftBlocked}
            question={question}
            problem={problem}
            onQuestion={(text: string) => {
              setQuestion(text)
              if (problem) setProblem(null)
            }}
            onSend={() => send(question)}
            onDraft={() => draft('draft')}
            onRemovePassage={() => {
              ask.setAbout(null)
              focusBox()
            }}
          />
        </>
      )}
      {deleting && (
        <DeleteConversationDialog
          conversation={deleting}
          questions={deleting.id === ask.conversation?.id ? count : deleting.questions}
          onDelete={async () => {
            await ask.remove(deleting.id)
            setDeleting(null)
            toast.success('Conversation deleted')
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
