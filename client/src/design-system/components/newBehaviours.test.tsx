// Tests for the CP-23 round 1 components: ReasonBox on Button/IconButton, Sheet, DatePicker.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './core/Button'
import { AddRow } from './display/AddRow'
import { IconAction } from './core/IconAction'
import { IconButton } from './core/IconButton'
import { StatusPill, statusLook } from './display/StatusPill'
import { Sheet } from './feedback/Sheet'
import { DatePicker } from './forms/DatePicker'

afterEach(cleanup)
const reason = { title: "Can't remove yet", text: 'It has 6 open assessments.' }

describe('disabled with a reason', () => {
  it('Button is aria-disabled, ignores clicks and shows the reason on focus', () => {
    const onClick = vi.fn()
    render(
      <Button disabledReason={reason} onClick={onClick}>
        Remove
      </Button>,
    )
    const b = screen.getByRole('button', { name: 'Remove' })
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b).not.toBeDisabled()
    // The words are in the DOM (hidden) before focus, so the control can describe itself.
    const described = document.getElementById(b.getAttribute('aria-describedby') as string)
    expect(described).toHaveTextContent(reason.text)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(b)
    expect(screen.getByText("Can't remove yet")).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent(reason.text)
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })
  // jsdom lays nothing out, so the rectangles are faked: the dialog is 400 x 300 and the box,
  // opened below the button, ends at `boxRight` and `boxBottom`.
  function showReasonInDialog(boxRight: number, boxBottom: number) {
    cleanup()
    // jsdom's window is 0 wide; a 1000px one keeps the window out of the way.
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000)
    const rect = (right: number, bottom: number) =>
      ({ top: 0, left: 0, right, bottom, width: right, height: bottom }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'DIALOG' ? rect(400, 300) : rect(boxRight, boxBottom)
    })
    render(
      <dialog open>
        <Button disabledReason={reason}>Save</Button>
      </dialog>,
    )
    fireEvent.focus(screen.getByRole('button', { name: 'Save' }))
    const box = screen.getByRole('tooltip')
    vi.restoreAllMocks()
    return box
  }
  it('keeps the reason box inside a dialog that would clip it: right-aligned and above', () => {
    const box = showReasonInDialog(500, 340)
    expect(box).toHaveAttribute('data-flip')
    expect(box).toHaveAttribute('data-up')
  })
  it('right-aligns a box that fits but would hang past the dialog’s content edge', () => {
    // Ends 10px inside the dialog, but past its 24px padding: it lines up with the button instead.
    expect(showReasonInDialog(390, 200)).toHaveAttribute('data-flip')
    // Well inside the content edge: left where it is.
    expect(showReasonInDialog(300, 200)).not.toHaveAttribute('data-flip')
  })
  it('IconAction says its tooltip once: no description when the name already holds its words', () => {
    render(
      <>
        <IconAction icon="x" label="Close" />
        <IconAction icon="trash-2" label="Remove Pin for Site" tooltip="Remove Pin" />
      </>,
    )
    const [close, remove] = screen.getAllByRole('button')
    act(() => close.focus())
    expect(close).not.toHaveAttribute('aria-describedby')
    act(() => close.blur())
    act(() => remove.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('Remove Pin')
    expect(remove).not.toHaveAttribute('aria-describedby')
  })
  it('draws every busy spinner with the one `ds-spin` class, so reduced motion can pulse it', () => {
    const { container } = render(
      <>
        <Button loading>Save</Button>
        <AddRow loading>Add</AddRow>
      </>,
    )
    expect(container.querySelectorAll('.ds-spin')).toHaveLength(2)
  })
  it('IconAction and AddRow keep focus while busy, and ignore presses', () => {
    const press = vi.fn()
    render(
      <>
        <IconAction icon="plus" label="Add" loading onClick={press} />
        <AddRow loading onClick={press}>
          Add more
        </AddRow>
      </>,
    )
    for (const name of ['Add', 'Add more']) {
      const b = screen.getByRole('button', { name })
      expect(b).not.toBeDisabled()
      expect(b).toHaveAttribute('aria-disabled', 'true')
      b.focus()
      expect(b).toHaveFocus()
      fireEvent.click(b)
    }
    expect(press).not.toHaveBeenCalled()
  })
  it('IconButton shows the reason on hover and stays inert', async () => {
    const onClick = vi.fn()
    render(<IconButton icon="trash-2" label="Remove" disabledReason={reason} onClick={onClick} />)
    const b = screen.getByRole('button', { name: 'Remove' })
    fireEvent.mouseEnter(b.parentElement as HTMLElement)
    // Hover waits 150 ms before the box shows (board 17 · 9).
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('6 open assessments')
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('status looks', () => {
  it('gives every stage an icon colour that shows on a white menu', () => {
    // Exported is white on its solid green pill; a Stage filter draws the icon alone, where
    // white on white was invisible (round 10).
    const stages = [
      'setup',
      'prepare',
      'capture',
      'ready_for_generation',
      'generate',
      'review',
      'ready_to_export',
      'exported',
      'archived',
    ]
    for (const stage of stages) {
      const { fg, ink } = statusLook(stage)
      expect(ink ?? fg, stage).not.toBe('var(--graphite-0)')
    }
    expect(statusLook('exported').fg).toBe('var(--graphite-0)')
  })
  it('draws the one long stage name on two lines, and every other stage on one', () => {
    // "Ready for generation" on one line made its pill far wider than the rest (round 10); the
    // two-line label is its own element so the pill can hug the words.
    const { container, rerender } = render(<StatusPill status="ready_for_generation" />)
    expect(screen.getByText('Ready for generation')).toHaveClass('ds-pill-lines')
    expect(container.querySelector('.ds-pill')).toHaveAttribute('data-lines', '2')
    rerender(<StatusPill status="ready_to_export" />)
    expect(container.querySelector('.ds-pill-lines')).toBeNull()
    expect(container.querySelector('.ds-pill')).not.toHaveAttribute('data-lines')
  })
})

describe('Sheet', () => {
  it('closes on Escape and shows a disabled row with its reason', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(
      <Sheet
        open
        onClose={onClose}
        title="Northgate"
        actions={[{ label: 'Remove client', disabledReason: 'Has open assessments', onSelect }]}
      />,
    )
    expect(screen.getByText('Has open assessments')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Remove client'))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Sheet stack', () => {
  it('Escape closes only the topmost of two open sheets', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <Sheet open onClose={outer} title="Outer">
          x
        </Sheet>
        <Sheet open onClose={inner} title="Inner">
          y
        </Sheet>
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('DatePicker', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }))
  it('blocks days before min', () => {
    const onChange = vi.fn()
    render(<DatePicker label="End" value="2027-02-16" min="2027-02-15" onChange={onChange} />)
    open()
    expect(screen.getByRole('button', { name: /14 February 2027/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /17 February 2027/ }))
    expect(onChange).toHaveBeenCalledWith('2027-02-17', { beforeMin: false })
  })
  it('reports a typed date before min', () => {
    const onChange = vi.fn()
    render(<DatePicker label="End" value="" min="2027-02-15" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '10/02/2027' } })
    expect(onChange).toHaveBeenCalledWith('2027-02-10', { beforeMin: true })
  })
  it('Clear empties and Today picks today', () => {
    const onChange = vi.fn()
    render(<DatePicker label="End" value="2027-02-16" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByText('Clear'))
    expect(onChange).toHaveBeenLastCalledWith('', { beforeMin: false })
    open()
    fireEvent.click(screen.getByText('Today'))
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(new Date().toLocaleDateString('en-CA'))
  })
  // Codex, AS-06 round 9: the field kept the old date on screen while the form held the new one.
  it('shows the picked day, and nothing after Clear, when the parent echoes the value', () => {
    function Held() {
      const [value, setValue] = useState('2027-02-16')
      return <DatePicker label="End" value={value} onChange={setValue} />
    }
    render(<Held />)
    open()
    fireEvent.click(screen.getByRole('button', { name: /17 February 2027/ }))
    expect(screen.getByRole('textbox')).toHaveValue('17/02/2027')
    open()
    fireEvent.click(screen.getByText('Clear'))
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
  it('closes the calendar when focus leaves the field and the calendar, not when it moves inside', () => {
    render(
      <>
        <DatePicker label="End" value="2027-02-16" onChange={vi.fn()} />
        <input aria-label="Next field" />
      </>,
    )
    const box = screen.getByRole('textbox', { name: 'End' })
    fireEvent.click(box)
    expect(screen.getByRole('dialog', { name: 'End' })).toBeInTheDocument()
    // Focus moving into the calendar's own buttons keeps it open.
    fireEvent.blur(box, { relatedTarget: screen.getByRole('button', { name: /17 February 2027/ }) })
    expect(screen.getByRole('dialog', { name: 'End' })).toBeInTheDocument()
    // Tab on to the next field closes it.
    fireEvent.blur(box, { relatedTarget: screen.getByRole('textbox', { name: 'Next field' }) })
    expect(screen.queryByRole('dialog', { name: 'End' })).not.toBeInTheDocument()
  })
  // Codex, round 9: closing on blur pulled focus back to the calendar button.
  it('closes when focus leaves the calendar for the next field, and leaves focus there', () => {
    render(
      <>
        <DatePicker label="End" value="2027-02-16" onChange={vi.fn()} />
        <input aria-label="Next field" />
      </>,
    )
    open()
    const day = screen.getByRole('button', { name: /17 February 2027/ })
    day.focus()
    const next = screen.getByLabelText('Next field')
    // Real focus moving on, as Tab from the calendar's last button does.
    act(() => next.focus())
    expect(screen.queryByRole('dialog', { name: 'End' })).not.toBeInTheDocument()
    expect(next).toHaveFocus()
  })
  it('closes the calendar when Tab leaves the typed field', () => {
    render(<DatePicker label="End" value="" onChange={vi.fn()} />)
    const box = screen.getByRole('textbox')
    fireEvent.click(box)
    expect(screen.getByRole('dialog', { name: 'End' })).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(screen.queryByRole('dialog', { name: 'End' })).not.toBeInTheDocument()
  })
  it('reports half-typed text as invalid and keeps the text', () => {
    const onChange = vi.fn()
    render(<DatePicker label="End" value="2027-02-16" onChange={onChange} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: '10/02/20' } })
    expect(onChange).toHaveBeenLastCalledWith('', { beforeMin: false, invalid: true })
    expect(box).toHaveValue('10/02/20')
  })
  it('opens the calendar on a click anywhere on the field, keeping focus there for typing', () => {
    render(<DatePicker label="End" value="" onChange={vi.fn()} />)
    const box = screen.getByRole('textbox')
    box.focus()
    fireEvent.click(box)
    expect(screen.getByRole('dialog', { name: 'End' })).toBeInTheDocument()
    expect(box).toHaveFocus()
    expect(box).toHaveAttribute('inputmode', 'numeric')
  })
  it('adds the slashes as digits are typed, and backspace removes digits', () => {
    const onChange = vi.fn()
    render(<DatePicker label="End" value="" onChange={onChange} />)
    const box = screen.getByRole('textbox')
    const typeIn = (value: string) => fireEvent.change(box, { target: { value } })
    typeIn('12')
    expect(box).toHaveValue('12')
    typeIn('120')
    expect(box).toHaveValue('12/0')
    typeIn('12/02/')
    expect(box).toHaveValue('12/02')
    typeIn('12/0')
    expect(box).toHaveValue('12/0')
    typeIn('12/022027')
    expect(box).toHaveValue('12/02/2027')
    expect(onChange).toHaveBeenLastCalledWith('2027-02-12', { beforeMin: false })
    // A day or month closed early with a slash gets its leading zero.
    typeIn('1/2/2027')
    expect(box).toHaveValue('01/02/2027')
    // An edit in the middle keeps the text as typed, so the caret doesn't jump.
    fireEvent.change(box, { target: { value: '01//2027', selectionStart: 3 } })
    expect(box).toHaveValue('01//2027')
  })
  it('arrow moves stop at min, and Today is disabled when today is before min', () => {
    render(<DatePicker label="End" value="2999-02-15" min="2999-02-15" onChange={vi.fn()} />)
    open()
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled()
    const day = screen.getByRole('button', { name: /15 February 2999/ })
    fireEvent.keyDown(day, { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: /15 February 2999/ })).toHaveAttribute(
      'tabindex',
      '0',
    )
  })
})
