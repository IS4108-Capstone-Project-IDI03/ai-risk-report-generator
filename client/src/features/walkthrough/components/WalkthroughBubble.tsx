// WalkthroughBubble (F-12, NEW pattern; from canvas-src/new-components): MarshBot's real face and
// speech bubble, with Skip (the round grey close), then either the stepper (Back, the step bar,
// Next) or answer buttons. Under 768 px the CSS makes it a sheet docked to the bottom edge.
// Called by WalkthroughHost. Calls IconAction, Button, StepBar, MarshBotFace, TypedText.
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Button, IconAction, StepBar } from '../../../design-system'
import { MarshBotFace } from '../../marshbot/components/MarshBotFace'
import type { BubbleView } from '../state'
import { TypedText } from './TypedText'

// Answer buttons: 14 / 600 like the words, 32 px high (44 on a phone or touch screen, --wt-answer),
// 16 px sides. A label never wraps: walkthrough.css gives each button at least its label's width.
const ANSWER: CSSProperties = {
  height: 'auto',
  minHeight: 'var(--wt-answer)',
  padding: '4px 16px',
  fontSize: 'var(--mbt-size)',
  fontWeight: 600,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

type Props = {
  view: BubbleView
  instant: boolean
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  style?: CSSProperties
  leaving?: boolean
  // Phone: the sheet's edge; 'top' when the highlight sits where the bottom sheet would cover it.
  dock?: 'bottom' | 'top'
  // The page behind is dimmed and blocked (a tell step): said to screen readers as a modal dialog.
  modal?: boolean
}

/** Returns the face and bubble; the host places it (beside the highlight, centred, or the corner). */
export const WalkthroughBubble = forwardRef<HTMLDivElement, Props>(function WalkthroughBubble(
  { view, instant, onBack, onNext, onSkip, style, leaving, dock, modal },
  ref,
) {
  // A press or key on the bubble shows the rest of the words at once.
  const [rushed, setRushed] = useState(false)
  const [done, setDone] = useState(false)
  const finished = useCallback(() => setDone(true), [])
  const { step, answers } = view
  // Two answers too wide for one row in the bubble (each never wraps, walkthrough.css): stacked.
  const answersRef = useRef<HTMLDivElement>(null)
  const [stack, setStack] = useState(false)
  useLayoutEffect(() => {
    const el = answersRef.current
    if (el && el.scrollWidth > el.clientWidth + 1) setStack(true)
  }, [])
  const last = !!step && step.at >= step.total
  const reason = step?.hands
    ? { title: 'Your turn', text: "I'll carry on as soon as you've done this step." }
    : undefined
  return (
    <div
      ref={ref}
      className="wt"
      role="dialog"
      aria-label="MarshBot"
      aria-modal={modal || undefined}
      tabIndex={-1}
      data-place={view.place}
      data-closable={view.closable || undefined}
      data-leaving={leaving || undefined}
      data-dock={dock}
      style={style}
      onPointerDown={() => setRushed(true)}
      // Not Tab or a modifier: moving focus through the bubble must not cut the typing short.
      onKeyDown={(e) => !/^(Tab|Shift|Control|Alt|Meta)$/.test(e.key) && setRushed(true)}
    >
      <span className="mbt-face wt-face">
        <MarshBotFace mood={view.mood} decorative />
      </span>
      {/* Shown on a phone only, where the face sits in the sheet's header row. */}
      <span className="mbt-who wt-who">MarshBot</span>
      <div className="mbt-bubble" data-tone="normal" data-tail>
        {view.closable && (
          <span className="wt-close">
            <IconAction icon="x" label="Skip walkthrough" size="sm" onClick={onSkip} />
          </span>
        )}
        <div className="wt-text">
          <TypedText
            say={view.say}
            typing={view.typing}
            instant={instant || rushed || !!view.rushed}
            onDone={finished}
          />
        </div>
        {step && (
          <div className="wt-foot">
            <IconAction
              icon="chevron-left"
              label="Back"
              size="md"
              shaded
              disabled={step.at <= 1 || step.noBack}
              onClick={onBack}
            />
            <StepBar at={step.at} total={step.total} current={step.hands ? 'waiting' : 'filled'} />
            <IconAction
              icon={last ? 'check' : 'chevron-right'}
              label={last ? 'Finish' : 'Next'}
              size="md"
              shaded
              // Greyed out and explained, never an error after a press (v2 section 2).
              disabledReason={reason}
              onClick={onNext}
            />
          </div>
        )}
        {answers && (
          <div
            ref={answersRef}
            className="wt-foot wt-answers"
            data-single={answers.length === 1 || undefined}
            data-stack={stack || undefined}
            data-in={done || undefined}
            // Not reachable until it has faded in, so nothing is pressed before it is read.
            inert={!done || undefined}
          >
            {answers.map((a, i) => (
              <Button
                key={a.label}
                variant={i === 0 && answers.length > 1 ? 'primary' : 'pill'}
                pill
                onClick={a.act}
                // The bubble's own text size, never larger than the words above (walkthrough.css).
                style={ANSWER}
              >
                <span className="wt-answer-label">{a.label}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
