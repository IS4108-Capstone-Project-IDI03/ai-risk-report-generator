// Tests for the tag picker, its tags and the edit page's tags (CP-36 AC1, AC3, AC8, AC9).
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kind } from './api'
import { KindBadges } from './components/KindBadges'
import { KindPicker } from './components/KindPicker'
import { ObservationKinds } from './components/ObservationKinds'
import { ObservationTagFilter } from './components/ObservationTagFilter'
import { hasTag, kindsFrom, tagFilterChips } from './noteKinds'

const suggest = vi.fn()
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  suggestKinds: (...a: unknown[]) => suggest(...a),
}))
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  suggest.mockReset()
  vi.useRealTimers()
})

// Holds the chosen tags the way a screen does.
function Harness({
  text = '',
  blurred = '',
  start = [] as Kind[],
  mode = 'draft' as 'draft' | 'saved',
  disabled = false,
  onChange = vi.fn(),
}) {
  const [value, setValue] = useState<Kind[]>(start)
  const [labels, setLabels] = useState<string[]>([])
  return (
    <KindPicker
      value={value}
      reference="R1"
      text={text}
      blurred={blurred}
      mode={mode}
      disabled={disabled}
      labels={labels}
      onLabels={setLabels}
      onChange={(k) => {
        onChange(k)
        setValue(k)
      }}
    />
  )
}
const chip = (name: string) => screen.getByRole('button', { name: new RegExp('^' + name) })
// Lets the debounce fire and the mocked call resolve.
const pause = (ms = 1300) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('KindPicker', () => {
  it('offers only Recommendation and Info request: no Fact tag', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /^Fact/ })).toBeNull()
    expect(chip('Recommendation')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('Info request')).toHaveAttribute('type', 'button')
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
  })

  it('maps chips and the fact checkbox to kinds', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(chip('Recommendation'))
    expect(onChange).toHaveBeenLastCalledWith(['recommendation'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'This note also states a fact' }))
    expect(onChange).toHaveBeenLastCalledWith(['fact', 'recommendation'])
    fireEvent.click(chip('Info request'))
    expect(onChange).toHaveBeenLastCalledWith(['fact', 'info_request', 'recommendation'])
    fireEvent.click(chip('Info request'))
    fireEvent.click(chip('Recommendation'))
    expect(onChange).toHaveBeenLastCalledWith([]) // no chip: a Fact, kinds absent
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('adds a custom label with Enter, removes it, and stops at 8', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add label' }))
    const input = screen.getByRole('textbox', { name: 'New label' })
    fireEvent.change(input, { target: { value: 'pump' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('pump')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove label pump' }))
    expect(screen.queryByText('pump')).toBeNull()
    // The box stays open for the next label until the eighth.
    for (let n = 0; n < 8; n++) {
      const box = screen.getByRole('textbox', { name: 'New label' })
      fireEvent.change(box, { target: { value: 'l' + n } })
      fireEvent.keyDown(box, { key: 'Enter' })
    }
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add label' })).toBeNull()
  })

  it('pre-selects a suggestion on a new form, marked Suggested, after a pause', async () => {
    suggest.mockResolvedValue(['fact', 'recommendation'])
    const onChange = vi.fn()
    render(<Harness text="Pump is old and should be replaced" onChange={onChange} />)
    expect(suggest).not.toHaveBeenCalled() // not before the pause
    await pause()
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['fact', 'recommendation'])
    expect(chip('Recommendation')).toHaveAttribute('data-suggested', 'true')
    expect(screen.getByRole('checkbox')).toBeChecked() // model said fact too
    // Touching the picker takes over: the mark goes and no new ask is made.
    fireEvent.click(chip('Info request'))
    expect(chip('Recommendation')).not.toHaveAttribute('data-suggested')
  })

  it('clears the suggested tags with the x', async () => {
    suggest.mockResolvedValue(['recommendation'])
    render(<Harness text="Replace the old pump soon" />)
    await pause()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggested tags' }))
    expect(chip('Recommendation')).toHaveAttribute('aria-pressed', 'false')
  })

  it('asks once per distinct text, and not for a short note', async () => {
    suggest.mockResolvedValue(['recommendation'])
    const { rerender } = render(
      <KindPicker value={[]} onChange={vi.fn()} reference="R1" text="Short" />,
    )
    await pause()
    expect(suggest).not.toHaveBeenCalled()
    rerender(<KindPicker value={[]} onChange={vi.fn()} reference="R1" text="Replace the pump" />)
    await pause()
    rerender(
      <KindPicker
        value={[]}
        onChange={vi.fn()}
        reference="R1"
        text="Replace the pump"
        blurred="Replace the pump"
      />,
    )
    await pause()
    expect(suggest).toHaveBeenCalledTimes(1)
  })

  it('asks at once on leaving the box', async () => {
    suggest.mockResolvedValue(['info_request'])
    render(<Harness text="Who services the pump?" blurred="Who services the pump?" />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(suggest).toHaveBeenCalledWith('R1', 'Who services the pump?')
  })

  it('ignores an answer for text that has changed', async () => {
    let resolve: (k: Kind[]) => void = () => {}
    suggest.mockReturnValue(new Promise<Kind[]>((r) => (resolve = r)))
    const { rerender } = render(
      <KindPicker value={[]} onChange={vi.fn()} reference="R1" text="Replace the pump" />,
    )
    await pause()
    rerender(<KindPicker value={[]} onChange={vi.fn()} reference="R1" text="Something else now" />)
    await act(async () => resolve(['recommendation']))
    expect(screen.getByRole('button', { name: /^Recommendation/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('stays silent on failure, and never asks while saving or once a tag is chosen', async () => {
    suggest.mockRejectedValue(new Error('503'))
    render(<Harness text="Pump is old and should be replaced" />)
    await pause()
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    suggest.mockClear()
    render(<Harness text="Pump is old and should be replaced" disabled />)
    render(<Harness text="Pump is old and rusty" start={['recommendation']} />)
    await pause()
    expect(suggest).not.toHaveBeenCalled()
  })

  it('on a saved observation shows Suggested with Add, and saves nothing until clicked', async () => {
    suggest.mockResolvedValue(['recommendation'])
    const onChange = vi.fn()
    render(<Harness mode="saved" text="Replace the old pump" onChange={onChange} />)
    await pause()
    expect(screen.getByText('Suggested: Recommendation')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onChange).toHaveBeenCalledWith(['recommendation'])
    expect(screen.queryByText(/Suggested:/)).toBeNull()
  })

  it('dismisses a saved observation suggestion', async () => {
    suggest.mockResolvedValue(['info_request'])
    render(<Harness mode="saved" text="Who services the pump?" />)
    await pause()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggestion' }))
    expect(screen.queryByText(/Suggested:/)).toBeNull()
  })
})

describe('KindBadges', () => {
  it('shows a tag per kind with a + Fact segment, labels, and nothing when untagged', () => {
    const { container, rerender } = render(
      <KindBadges kinds={['fact', 'recommendation']} labels={['pump']} />,
    )
    expect(screen.getByText('Recommendation')).toBeInTheDocument()
    expect(screen.getByText('+ Fact')).toBeInTheDocument()
    expect(screen.getByText('pump')).toBeInTheDocument()
    rerender(<KindBadges kinds={['fact']} />)
    expect(container).toBeEmptyDOMElement() // Fact alone is the default
    rerender(<KindBadges />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ObservationKinds (the edit page)', () => {
  beforeEach(() => vi.useRealTimers())
  it('saves a choice, and clearing the last tag sends null', async () => {
    const save = vi.fn().mockResolvedValue(true)
    render(<ObservationKinds kinds={['recommendation']} canChange save={save} text="" />)
    fireEvent.click(chip('Info request'))
    expect(save).toHaveBeenLastCalledWith({ kinds: ['info_request', 'recommendation'] })
    fireEvent.click(chip('Info request'))
    fireEvent.click(chip('Recommendation'))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ kinds: null }))
  })

  it('saves labels, and null when the last is removed', async () => {
    const save = vi.fn().mockResolvedValue(true)
    render(<ObservationKinds labels={['pump']} canChange save={save} text="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove label pump' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ labels: null }))
  })

  it('puts the tags back when the save is refused', async () => {
    const save = vi.fn().mockResolvedValue(false)
    render(<ObservationKinds kinds={['recommendation']} canChange save={save} text="" />)
    fireEvent.click(chip('Info request'))
    await waitFor(() => expect(chip('Info request')).toHaveAttribute('aria-pressed', 'false'))
  })

  it('shows tags and no buttons to someone who cannot change it', () => {
    render(<ObservationKinds kinds={['info_request']} canChange={false} save={vi.fn()} text="" />)
    expect(screen.getByText('Info request')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('tag filter', () => {
  const rows = [
    { kinds: ['recommendation'] as Kind[], labels: ['pump'] },
    { kinds: ['info_request'] as Kind[] },
    { kinds: ['fact', 'recommendation'] as Kind[] },
    {},
  ]
  it('counts each tag in use and filters by it', () => {
    const chips = tagFilterChips(rows)
    expect(chips.map((c) => [c.label, c.count])).toEqual([
      ['All', 4],
      ['Recommendation', 2],
      ['Info request', 1],
      ['pump', 1],
    ])
    expect(rows.filter((o) => hasTag(o, 'label:pump'))).toHaveLength(1)
    expect(kindsFrom(['info_request'], true)).toEqual(['fact', 'info_request'])
  })

  it('renders chips as pressable buttons and picks one', () => {
    const setObsTag = vi.fn()
    const v = { obsTagChips: tagFilterChips(rows), obsTag: '', setObsTag } as never
    render(<ObservationTagFilter v={v} />)
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Info request/ }))
    expect(setObsTag).toHaveBeenCalledWith('info_request')
  })

  it('shows no row while nothing is tagged', () => {
    const v = { obsTagChips: tagFilterChips([{}]), obsTag: '', setObsTag: vi.fn() } as never
    const { container } = render(<ObservationTagFilter v={v} />)
    expect(container).toBeEmptyDOMElement()
  })
})
