// Tests for the CP-23 round 1 components: ReasonBox on Button/IconButton, Sheet, DatePicker.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './core/Button'
import { IconButton } from './core/IconButton'
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
