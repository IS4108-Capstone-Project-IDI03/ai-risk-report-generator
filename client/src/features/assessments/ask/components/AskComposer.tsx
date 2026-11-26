// The Ask tab's question box (AS-01), sticky at the foot of the panel: a passage asked about or
// being rewritten (AS-02, AS-04) above it, then Dictate, Draft text (AS-04, for the assigned
// engineer) and Ask, or Stop while an answer is written. Enter asks; Shift+Enter starts a new line.
// The words and what they do live in AskPanel.tsx; this file only draws the form.
import type { RefObject } from 'react'
import { Button, Textarea, type Reason } from '../../../../design-system'
import { Tip } from '../../../help/Tip'
import { DictateButton } from '../../dictation/DictateButton'
import type { AskPassage } from '../passage'
import type { AskWorkflow } from '../useAsk'
import { PassageQuote } from './PassageQuote'

// Must match AskPanel.tsx's check before sending.
const MAX_QUESTION = 1000

/** Returns the question form; `boxRef` holds the textarea so the panel can focus it. */
export function AskComposer({
  formRef,
  boxRef,
  ask,
  about,
  rewriting,
  drafting,
  draftBlocked,
  question,
  problem,
  onQuestion,
  onSend,
  onDraft,
  onRemovePassage,
}: {
  formRef: RefObject<HTMLFormElement | null>
  boxRef: RefObject<HTMLDivElement | null>
  ask: AskWorkflow
  about: AskPassage | null
  rewriting: boolean
  // Whether Draft text is offered (the assigned engineer).
  drafting: boolean
  draftBlocked?: Reason
  question: string
  problem: string | null
  onQuestion: (text: string) => void
  onSend: () => void
  onDraft: () => void
  onRemovePassage: () => void
}) {
  return (
    <form
      ref={formRef}
      className="ask-composer"
      aria-label="Ask a question"
      data-walk="ask.composer"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      {about && (
        <PassageQuote
          passage={about}
          heading={`${rewriting ? 'Rewriting' : 'Asking about'} ${about.label}`}
          onRemove={onRemovePassage}
        />
      )}
      {/* One rounded box, as the knowledge chat's composer: the question, then its buttons. */}
      <div className="ask-composer-box">
        <div ref={boxRef}>
          <Textarea
            label={rewriting ? 'How to rewrite it' : 'Question'}
            name="question"
            rows={3}
            value={question}
            maxLength={MAX_QUESTION}
            placeholder={
              rewriting
                ? 'e.g. Make it more concise, keeping its citations (optional)'
                : about
                  ? 'e.g. Where does this figure come from?'
                  : drafting
                    ? 'e.g. Which observations concern the valves? Or: Draft a paragraph on flood exposure'
                    : 'e.g. Which observations concern the sprinkler control valves?'
            }
            error={problem ?? undefined}
            onChange={(event) => onQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter asks; Shift+Enter starts a new line.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!ask.busy) onSend()
              }
            }}
          />
        </div>
        <div className="ask-composer-actions">
          {!ask.busy && (
            <DictateButton
              reference={ask.reference}
              field={() => boxRef.current?.querySelector('textarea')}
              onChange={onQuestion}
            />
          )}
          {ask.busy ? (
            <Button
              pill
              type="button"
              variant="secondary"
              size="sm"
              iconLeft="square"
              onClick={ask.stop}
            >
              Stop
            </Button>
          ) : rewriting ? (
            <Button
              pill
              type="submit"
              variant="primary"
              size="sm"
              iconLeft="sparkles"
              disabled={ask.switching}
            >
              Rewrite
            </Button>
          ) : (
            <>
              {drafting && (
                <>
                  <Tip id="ask.draft-text" align="right" />
                  <Button
                    pill
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconLeft="pen-line"
                    disabled={ask.switching}
                    disabledReason={draftBlocked}
                    data-walk="ask.draft-text"
                    onClick={() => onDraft()}
                  >
                    Draft text
                  </Button>
                </>
              )}
              <Button
                pill
                type="submit"
                variant="primary"
                size="sm"
                iconLeft="sparkles"
                disabled={ask.switching}
              >
                Ask
              </Button>
            </>
          )}
        </div>{' '}
      </div>
      <div className="ask-hint">
        {rewriting
          ? 'Enter to rewrite, Shift+Enter for a new line'
          : 'Enter to ask, Shift+Enter for a new line'}
      </div>
    </form>
  )
}
