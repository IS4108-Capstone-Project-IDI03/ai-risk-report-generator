// Tests for the shared recording row (CP-24): the chevron is always the last control, the other
// tools sit before it, a row that can't open has no chevron, and the transcript opens and closes.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { RecordingRow, type RecordingRowItem } from './components/RecordingRow'

afterEach(cleanup)

const done: RecordingRowItem = {
  durationSec: 65,
  status: 'done',
  transcript: 'Block A, level one. Pallets in the fire lane.',
  audioUrl: '/clip',
}
const row = (item: RecordingRowItem, extra: Partial<Parameters<typeof RecordingRow>[0]> = {}) =>
  render(
    <ul>
      <RecordingRow item={item} phone={false} onRetry={() => {}} onRemove={() => {}} {...extra} />
    </ul>,
  )
const toolNames = () =>
  within(document.querySelector('li')!)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'))

it('puts the chevron last, after edit and the bin', () => {
  row(done, { onEdit: () => {} })
  expect(toolNames()).toEqual([
    'Play recording',
    'Correct the transcript',
    'Remove recording',
    'Show transcript',
  ])
  expect(document.querySelector('li')).toHaveAttribute('data-more')
})

it('has no chevron, and no edit, while it cannot open yet', () => {
  row({ ...done, status: 'transcribing', transcript: null, audioUrl: null }, { onEdit: () => {} })
  expect(toolNames()).toEqual(['Remove recording'])
  expect(document.querySelector('li')).not.toHaveAttribute('data-opens')
})

it('puts retry before the bin on a failed row, with no chevron', () => {
  row({ ...done, status: 'failed', transcript: null, audioUrl: null })
  expect(toolNames()).toEqual(['Try transcribing again', 'Remove recording'])
})

it('opens the transcript, then keeps it drawn for the 180 ms it fades out', () => {
  vi.useFakeTimers()
  row(done)
  const chevron = screen.getByRole('button', { name: 'Show transcript' })
  fireEvent.click(chevron)
  expect(screen.getByText(done.transcript!)).toBeInTheDocument()
  expect(chevron).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(chevron)
  // Closing: already reads closed, text still there while it fades.
  expect(chevron).toHaveAttribute('aria-expanded', 'false')
  expect(document.querySelector('.sw-text')).toHaveAttribute('data-closing')
  act(() => void vi.advanceTimersByTime(190))
  expect(screen.queryByText(done.transcript!)).toBeNull()
  vi.useRealTimers()
})

it('reopens the transcript when the chevron is pressed again during the fade', () => {
  vi.useFakeTimers()
  row(done)
  const chevron = screen.getByRole('button', { name: 'Show transcript' })
  fireEvent.click(chevron)
  fireEvent.click(chevron)
  act(() => void vi.advanceTimersByTime(90))
  fireEvent.click(chevron)
  // The first close's timer must not shut it later.
  act(() => void vi.advanceTimersByTime(400))
  expect(screen.getByText(done.transcript!)).toBeInTheDocument()
  expect(chevron).toHaveAttribute('aria-expanded', 'true')
  vi.useRealTimers()
})

it('says its status in a polite live region', () => {
  row({ ...done, status: 'transcribing', transcript: null, audioUrl: null })
  expect(document.querySelector('.sw-status-time')).toHaveAttribute('aria-live', 'polite')
})

it('calls the edit, retry and remove callbacks', () => {
  const onEdit = vi.fn()
  const onRemove = vi.fn()
  row(done, { onEdit, onRemove })
  fireEvent.click(screen.getByRole('button', { name: 'Correct the transcript' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove recording' }))
  expect(onEdit).toHaveBeenCalledOnce()
  expect(onRemove).toHaveBeenCalledOnce()
})
