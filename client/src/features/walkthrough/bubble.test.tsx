// The walkthrough bubble (F-12, test seam 4): Back and Next on first, middle, last, hands-on and
// waiting steps; a question's equal buttons and no stepper; the message read out whole; letters.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { blocksOf } from './components/words'
import { WalkthroughBubble } from './components/WalkthroughBubble'
import type { BubbleView } from './state'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SAY =
  "Let's start with your work. It lives in these 3 tabs:\n- **Assessments** lists every assessment.\n- **Calendar** shows your dates."
const view = (over: Partial<BubbleView>): BubbleView => ({
  key: 'k',
  say: SAY,
  mood: 'idle',
  place: 'target',
  closable: true,
  typing: 0,
  ...over,
})
const draw = (v: BubbleView, instant = true) =>
  render(
    <WalkthroughBubble
      view={v}
      instant={instant}
      onBack={() => {}}
      onNext={() => {}}
      onSkip={() => {}}
    />,
  )
const button = (name: string) => screen.getByRole('button', { name })
const blocked = (name: string) =>
  button(name).hasAttribute('disabled') || button(name).getAttribute('aria-disabled') === 'true'

describe('the stepper', () => {
  it('first step: Back greyed but in place; Next live', () => {
    draw(view({ step: { at: 1, total: 6 } }))
    expect(blocked('Back')).toBe(true)
    expect(blocked('Next')).toBe(false)
    expect(screen.getByText('Step 1 of 6')).toBeTruthy()
    expect(button('Skip walkthrough')).toBeTruthy()
  })

  it('middle step: both live; last step: Next is a tick named Finish', () => {
    draw(view({ step: { at: 3, total: 6 } }))
    expect(blocked('Back')).toBe(false)
    cleanup()
    draw(view({ step: { at: 6, total: 6 } }))
    expect(button('Finish')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('hands-on and waiting steps grey Next and say why', () => {
    draw(view({ step: { at: 2, total: 6, turn: 'hands' } }))
    expect(blocked('Next')).toBe(true)
    expect(screen.getByText(/Press the highlighted button to carry on\./)).toBeTruthy()
    cleanup()
    draw(view({ step: { at: 2, total: 6, turn: 'wait' } }))
    expect(screen.getByText(/I'll carry on when this is ready\./)).toBeTruthy()
  })

  it('fills the current segment, but leaves a hands-on one empty until it lands', () => {
    const { container } = draw(view({ step: { at: 2, total: 4, turn: 'hands' } }))
    const states = () =>
      [...container.querySelectorAll('.ds-seg')].map((s) => s.getAttribute('data-state'))
    expect(states()).toEqual(['done', 'empty', 'empty', 'empty'])
    cleanup()
    const again = draw(view({ step: { at: 2, total: 4, turn: 'hands', done: true } }))
    expect(
      [...again.container.querySelectorAll('.ds-seg')].map((s) => s.getAttribute('data-state')),
    ).toEqual(['done', 'done', 'empty', 'empty'])
  })
})

describe('a question', () => {
  it('has no stepper and no Skip; its buttons share one row, the first the primary', () => {
    const { container } = draw(
      view({
        closable: false,
        answers: [
          { label: 'Show me', act: () => {} },
          { label: 'Not now', act: () => {} },
        ],
      }),
    )
    expect(screen.queryByText(/^Step/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip walkthrough' })).toBeNull()
    const row = container.querySelector('.wt-answers')!
    expect(row.hasAttribute('data-single')).toBe(false)
    expect(row.querySelectorAll('button')).toHaveLength(2)
  })

  it('a single OK keeps its own width at the right', () => {
    const { container } = draw(view({ closable: false, answers: [{ label: 'OK', act: () => {} }] }))
    expect(container.querySelector('.wt-answers')!.hasAttribute('data-single')).toBe(true)
  })
})

describe('the words', () => {
  it('are read out whole, once, while the letters are hidden from screen readers', () => {
    const { container } = draw(view({}))
    expect(
      screen.getByText(/Let's start with your work\. It lives in these 3 tabs: Assessments lists/),
    ).toBeTruthy()
    expect(container.querySelector('.wt-typed > [aria-hidden]')).toBeTruthy()
  })

  it('split into a lead-in and bullets, with bold key words', () => {
    expect(blocksOf(SAY).map((b) => b.bullet)).toEqual([false, true, true])
    expect(blocksOf(SAY)[1].runs[0]).toEqual({ text: 'Assessments', bold: true })
    expect(blocksOf('One.\n\nShall we carry on?')).toHaveLength(2)
  })

  it('arrive letter by letter, 14 ms apart, then the answers come in; reduced motion shows all at once', async () => {
    vi.useFakeTimers()
    const answers = [{ label: 'OK', act: () => {} }]
    const { container } = draw(
      view({ say: 'Hi there.', answers, closable: false, typing: 700 }),
      false,
    )
    const delays = [...container.querySelectorAll<HTMLElement>('.wt-ch')].map(
      (c) => c.style.animationDelay,
    )
    expect(delays.slice(0, 3)).toEqual(['700ms', '714ms', '728ms'])
    expect(container.querySelector('.mb-typing')).toBeTruthy()
    expect(container.querySelector('.wt-answers')!.hasAttribute('data-in')).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(700 + 9 * 14))
    expect(container.querySelector('.mb-typing')).toBeNull()
    expect(container.querySelector('.wt-answers')!.hasAttribute('data-in')).toBe(true)
    vi.useRealTimers()
    cleanup()
    const calm = draw(view({ say: 'Hi there.', answers, closable: false, typing: 700 }), true)
    expect(calm.container.querySelector('.wt-typed')!.hasAttribute('data-instant')).toBe(true)
    expect(calm.container.querySelector('.wt-answers')!.hasAttribute('data-in')).toBe(true)
  })

  it('a long message is capped at 2.4 s; a press on the bubble shows the rest', () => {
    const long = 'x'.repeat(400)
    const { container } = draw(view({ say: long }), false)
    const last = [...container.querySelectorAll<HTMLElement>('.wt-ch')].at(-1)!
    expect(parseFloat(last.style.animationDelay)).toBeLessThanOrEqual(2400)
    fireEvent.pointerDown(container.querySelector('.wt')!)
    expect(container.querySelector('.wt-typed')!.hasAttribute('data-instant')).toBe(true)
  })
})
