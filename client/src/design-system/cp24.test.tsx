// Tests for the CP-24 design-system components: PickerField states and callbacks, the unsure
// RowMark, AddMenuButton, TableFooter tone, RecordHeader, RecordStepper and FailedLine.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import * as UI from './index'

afterEach(cleanup)

// A stand-in list: the trigger, and a menu that shows while open.
function list({ trigger }: UI.PickerListSlot) {
  return <Menu trigger={trigger} />
}
function Menu({ trigger }: { trigger: UI.PickerListSlot['trigger'] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      {trigger(open, () => setOpen(!open))}
      {open && <ul aria-label="Choices" />}
    </div>
  )
}
import { useState } from 'react'

const filled = { label: 'Severity', value: <span>High</span>, valueLabel: 'High', list }

it('draws a filled field with no marks and opens its list', () => {
  render(<UI.PickerField {...filled} />)
  expect(screen.queryByRole('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Severity: High. Change' }))
  expect(screen.getByRole('list', { name: 'Choices' })).toBeInTheDocument()
})

it('shows waiting words in blue while suggesting, and opens nothing', () => {
  const { container } = render(
    <UI.PickerField {...filled} value={undefined} suggesting="Suggesting" />,
  )
  expect(container.querySelector('.cpf')).toHaveAttribute('data-waiting')
  const button = screen.getByRole('button', { name: 'Severity: Suggesting' })
  expect(button).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(button)
  expect(screen.queryByRole('list', { name: 'Choices' })).toBeNull()
})

it('marks a not-sure value, and Confirm and Change act on it', () => {
  const onConfirm = vi.fn()
  render(<UI.PickerField {...filled} notSure onConfirm={onConfirm} />)
  expect(screen.getByRole('img', { name: 'Not sure, check it' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm severity' }))
  expect(onConfirm).toHaveBeenCalledOnce()
  // Change opens the same list the field opens.
  fireEvent.click(screen.getByRole('button', { name: 'Change severity' }))
  expect(screen.getByRole('list', { name: 'Choices' })).toBeInTheDocument()
})

it('fades the mark and the actions out once the value is confirmed, then removes them', () => {
  vi.useFakeTimers()
  const { rerender } = render(<UI.PickerField {...filled} notSure onConfirm={() => {}} />)
  rerender(<UI.PickerField {...filled} onConfirm={() => {}} />)
  // Still drawn for the 120 ms fade, but no longer announced.
  expect(screen.queryByRole('img', { name: 'Not sure, check it' })).toBeNull()
  expect(document.querySelector('.cpf-mark[data-out]')).not.toBeNull()
  act(() => void vi.advanceTimersByTime(130))
  expect(document.querySelector('.cpf-mark')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Confirm severity' })).toBeNull()
  vi.useRealTimers()
})

it('shows the failed mark, and a plain error line', () => {
  const { rerender } = render(<UI.PickerField {...filled} failed />)
  expect(screen.getByRole('img', { name: 'Suggestion failed' })).toBeInTheDocument()
  rerender(<UI.PickerField {...filled} error="Choose a severity" />)
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a severity')
  expect(screen.getByRole('button', { name: /^Severity/ })).toHaveAttribute('aria-invalid', 'true')
})

it('lets a value arrive after waiting words: they fade out as the value rises in', () => {
  vi.useFakeTimers()
  const { rerender, container } = render(
    <UI.PickerField {...filled} value={undefined} suggesting="Suggesting" />,
  )
  rerender(<UI.PickerField {...filled} />)
  expect(container.querySelector('.cpf-was')).toHaveTextContent('Suggesting')
  expect(container.querySelector('.cpf-now')).toHaveAttribute('data-in')
  act(() => void vi.advanceTimersByTime(110))
  expect(container.querySelector('.cpf-was')).toBeNull()
  vi.useRealTimers()
})

it('shows the marks of a view-only field but no actions and no list', () => {
  render(<UI.PickerField {...filled} notSure disabled onConfirm={() => {}} />)
  expect(screen.getByRole('img', { name: 'Not sure, check it' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Confirm severity' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Severity/ }))
  expect(screen.queryByRole('list', { name: 'Choices' })).toBeNull()
})

it('draws the amber unsure kind of RowMark', () => {
  render(<UI.RowMark kind="unsure" />)
  expect(screen.getByRole('img', { name: 'Not sure' })).toBeInTheDocument()
  expect(document.querySelector('.ds-mark-unsure')).not.toBeNull()
})

it('tones the footer link and calls it back', () => {
  const onLate = vi.fn()
  render(
    <UI.TableFooter late="4 to check" onLateClick={onLate} tone="warn">
      {'27 observations'}
    </UI.TableFooter>,
  )
  expect(document.querySelector('.ds-table-footer')).toHaveAttribute('data-tone', 'warn')
  fireEvent.click(screen.getByRole('button', { name: '4 to check' }))
  expect(onLate).toHaveBeenCalledOnce()
})

it('offers each add option and gives back its value', () => {
  const onChoose = vi.fn()
  render(
    <UI.AddMenuButton
      label="Add observation"
      onChoose={onChoose}
      options={[
        {
          value: 'manual',
          icon: 'pencil-line',
          label: 'Add observation manually',
          note: 'By hand.',
          tone: 'form',
        },
        {
          value: 'walk',
          icon: 'mic',
          label: 'Record a site walk',
          note: 'Talk it through.',
          tone: 'walk',
        },
      ]}
    >
      {'Add observation'}
    </UI.AddMenuButton>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
  fireEvent.click(screen.getByRole('button', { name: /Record a site walk/ }))
  expect(onChoose).toHaveBeenCalledWith('walk')
})

it('draws the record header and steps through records', () => {
  const back = vi.fn()
  const prev = vi.fn()
  const next = vi.fn()
  render(
    <UI.RecordHeader
      back="Observations"
      onBack={back}
      tile={<i />}
      eyebrow="Block A"
      title="Valve shut"
      actions={<UI.RecordStepper at={1} total={3} onPrevious={prev} onNext={next} />}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Back to Observations' }))
  expect(back).toHaveBeenCalledOnce()
  expect(screen.getByRole('heading', { name: 'Valve shut' })).toBeInTheDocument()
  // The title is cut with an ellipsis when long, so the full name is on hover.
  expect(screen.getByRole('heading', { name: 'Valve shut' })).toHaveAttribute('title', 'Valve shut')
  // At the first record, Previous is off.
  expect(screen.getByRole('button', { name: 'Previous observation' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Next observation' }))
  expect(next).toHaveBeenCalledOnce()
  expect(prev).not.toHaveBeenCalled()
})

it('calls Try again from the failed line', () => {
  const again = vi.fn()
  render(<UI.FailedLine message="Suggestion failed" onAction={again} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Suggestion failed')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(again).toHaveBeenCalledOnce()
})

it('tells a screen reader the add button is expanded when its phone sheet is open', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  render(
    <UI.AddMenuButton
      label="Add observation"
      onChoose={() => {}}
      options={[
        { value: 'manual', icon: 'pencil-line', label: 'By hand', note: 'x', tone: 'form' },
      ]}
    >
      {'Add observation'}
    </UI.AddMenuButton>,
  )
  const button = screen.getByRole('button', { name: 'Add observation' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  vi.unstubAllGlobals()
})
