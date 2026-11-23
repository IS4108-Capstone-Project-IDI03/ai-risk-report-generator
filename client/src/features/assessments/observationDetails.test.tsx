// Tests for the observation page's Details card and handwritten page row (CP-24, test seam 5): each
// field state from a fixture, Confirm and Change calling the one update, Try again, a view-only
// user, and the page row's control order and states. Calls ObservationDetails, PageEntry.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onSignal } from '../walkthrough/signals'
import { ObservationDetails, type DetailsView } from './components/ObservationDetails'
import { PageEntry, type PageView } from './components/PageEntry'

afterEach(cleanup)

const base: DetailsView = {
  canChange: true,
  cats: ['Protection'],
  catLabel: 'Protection',
  sev: 'high',
  sevLabel: 'High',
  locationId: 'l1',
  where: 'Block A › Pump house',
  path: { building: 'Block A', floor: null, name: 'Pump house', bare: false },
  suggestion: null,
  retrySuggestion: null,
}
const locations = [{ value: 'l1', label: 'Pump house' }]

function card(o: Partial<DetailsView> = {}, save = vi.fn().mockResolvedValue(true)) {
  const onConfirmed = vi.fn()
  render(
    <ObservationDetails
      o={{ ...base, ...o }}
      locations={locations}
      save={save}
      onConfirmed={onConfirmed}
      stamps={null}
    />,
  )
  return { save, onConfirmed }
}

describe('Details card (CP-24)', () => {
  it('draws a filled observation plainly, with no marks or actions', () => {
    card()
    expect(screen.queryByRole('img', { name: 'Not sure, check it' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull()
    expect(screen.queryByText('Suggestion failed')).toBeNull()
  })

  it('shows the waiting words while a field is empty and being suggested', () => {
    card({ cats: [], catLabel: '', sev: '', sevLabel: '', suggestion: reading() })
    expect(screen.getByText('Suggesting a category')).toBeInTheDocument()
    expect(screen.getByText('Suggesting a severity')).toBeInTheDocument()
  })

  it('keeps the engineer’s own value while the other is suggested', () => {
    card({ sev: '', sevLabel: '', suggestion: reading() })
    expect(screen.queryByText('Suggesting a category')).toBeNull()
    expect(screen.getByText('Suggesting a severity')).toBeInTheDocument()
  })

  it('marks a not-sure value; Confirm saves one confirm and says so, Change saves the choice', async () => {
    const { save, onConfirmed } = card({
      suggestion: done({ severity: { notSure: true } }),
    })
    expect(screen.getByRole('img', { name: 'Not sure, check it' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm category' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm severity' }))
    expect(save).toHaveBeenCalledWith({ confirm: ['severity'] })
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledWith('severity'))

    fireEvent.click(screen.getByRole('button', { name: 'Change severity' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Low' }))
    expect(save).toHaveBeenLastCalledWith({ sev: 'low' })
  })

  it('does not say confirmed when the confirm was refused', async () => {
    const { onConfirmed } = card(
      { suggestion: done({ category: { notSure: true } }) },
      vi.fn().mockResolvedValue(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm category' }))
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm category' })).toBeEnabled(),
    )
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  // F-12: "Check your observations" moves on only once the Confirm is saved, never on the press.
  it('raises observation-category-confirmed only once a category Confirm is saved', async () => {
    const heard = vi.fn()
    const stop = onSignal('observation-category-confirmed', heard)
    const refused = vi.fn().mockResolvedValue(false)
    card({ suggestion: done({ category: { notSure: true } }) }, refused)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm category' }))
    await vi.waitFor(() => expect(refused).toHaveBeenCalled())
    await act(async () => {})
    expect(heard).not.toHaveBeenCalled()
    cleanup()
    card({ suggestion: done({ category: { notSure: true } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm category' }))
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
    stop()
  })

  it('turns both empty fields red under one Suggestion failed line, and Try again retries', () => {
    const retry = vi.fn()
    card({
      cats: [],
      catLabel: '',
      sev: '',
      sevLabel: '',
      suggestion: { status: 'failed', error: 'x', category: null, severity: null },
      retrySuggestion: retry,
    })
    expect(screen.getByRole('button', { name: /^Category: Choose a category/ })).toBeInvalid()
    expect(screen.getByRole('button', { name: /^Severity: Choose a severity/ })).toBeInvalid()
    expect(screen.getAllByText('Suggestion failed')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('shows Suggestion failed and Try again when a re-reading fails over filled values, with no field red', () => {
    const retry = vi.fn()
    card({
      suggestion: { status: 'failed', error: 'x', category: { notSure: true }, severity: null },
      retrySuggestion: retry,
    })
    expect(screen.getByRole('button', { name: /^Category: / })).toBeValid()
    expect(screen.getByRole('button', { name: /^Severity: / })).toBeValid()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('shows a view-only user the marks, with no Confirm, Change or Try again', () => {
    card({
      canChange: false,
      suggestion: done({ severity: { notSure: true } }),
    })
    expect(screen.getByRole('img', { name: 'Not sure, check it' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull()
    cleanup()
    card({
      canChange: false,
      cats: [],
      catLabel: '',
      suggestion: { status: 'failed', error: 'x', category: null, severity: null },
    })
    expect(screen.getByText('Suggestion failed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('opens a field’s list when its label word is pressed', async () => {
    card()
    fireEvent.click(screen.getByText('Severity'))
    expect(await screen.findByRole('menuitemradio', { name: 'Low' })).toBeInTheDocument()
  })

  it('has none of the removed buttons', () => {
    card()
    for (const name of [/Get AI proposal/, /Suggest again/, /Describe photos/, /Describe again/])
      expect(screen.queryByRole('button', { name })).toBeNull()
  })
})

function reading() {
  return { status: 'reading' as const, error: null, category: null, severity: null }
}
function done(entries: Partial<NonNullable<DetailsView['suggestion']>>) {
  return {
    status: 'done' as const,
    error: null,
    category: null,
    severity: null,
    ...entries,
  }
}

const page = (fields: Partial<PageView> = {}): PageView => ({
  id: 'pg1',
  name: 'Page 1',
  url: '/p.png',
  status: 'transcribed',
  transcript: 'Valve shut 4 m from pump',
  original: null,
  uncertain: [],
  error: null,
  correction: null,
  added: null,
  note: null,
  retry: null,
  again: vi.fn(),
  correct: vi.fn(),
  remove: vi.fn(),
  correctedLabel: null,
  addedLabel: null,
  ...fields,
})
const row = (p: PageView, onView = vi.fn()) =>
  render(
    <ul>
      <PageEntry page={p} onView={onView} />
    </ul>,
  )
const names = (el: HTMLElement) =>
  within(el)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'))

describe('Handwritten page row (CP-24)', () => {
  it('puts edit, transcribe again and the bin together, then the chevron last', () => {
    row(page())
    expect(names(screen.getByRole('listitem'))).toEqual([
      'Open Page 1',
      'Edit text of Page 1',
      'Transcribe Page 1 again',
      'Remove Page 1',
      'Show text',
    ])
  })

  it('reopens the text when the chevron is pressed again during the fade, and reads its status politely', () => {
    vi.useFakeTimers()
    row(page())
    expect(document.querySelector('.sw-status-time')).toHaveAttribute('aria-live', 'polite')
    const chevron = screen.getByRole('button', { name: 'Show text' })
    fireEvent.click(chevron)
    fireEvent.click(screen.getByRole('button', { name: 'Hide text' }))
    act(() => void vi.advanceTimersByTime(90))
    fireEvent.click(screen.getByRole('button', { name: 'Show text' }))
    act(() => void vi.advanceTimersByTime(400))
    expect(screen.getByRole('button', { name: 'Hide text' })).toBeInTheDocument()
    expect(screen.getByText('Valve shut 4 m from pump')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('says unsure words once on the row in amber, and underlines them in the open text', () => {
    row(
      page({
        uncertain: [
          [6, 10],
          [11, 14],
        ],
      }),
    )
    expect(screen.getByText('2 words unsure')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show text' }))
    const marks = document.querySelectorAll('mark.cpg-mark')
    expect(marks).toHaveLength(2)
    expect(screen.queryByText(/Check them against the page/)).toBeNull()
  })

  it('opens the page to zoom from its round mark', () => {
    const onView = vi.fn()
    row(page(), onView)
    fireEvent.click(screen.getByRole('button', { name: 'Open Page 1' }))
    expect(onView).toHaveBeenCalledOnce()
  })

  it('shows Transcribing with only the bin, and no chevron to open', () => {
    row(
      page({
        status: 'transcribing',
        transcript: null,
        again: null,
        correct: null,
        note: 'Transcribing the page…',
      }),
    )
    expect(screen.getByText('Transcribing')).toBeInTheDocument()
    expect(names(screen.getByRole('listitem'))).toEqual(['Open Page 1', 'Remove Page 1'])
  })

  it('shows Couldn’t transcribe with Retry beside the bin, and no chevron', () => {
    const retry = vi.fn()
    row(
      page({
        status: 'failed',
        transcript: null,
        again: null,
        correct: null,
        error: 'Timed out.',
        retry,
      }),
    )
    expect(screen.getByText(/Couldn’t transcribe/)).toBeInTheDocument()
    expect(names(screen.getByRole('listitem'))).toEqual([
      'Open Page 1',
      'Try transcribing Page 1 again',
      'Remove Page 1',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Try transcribing Page 1 again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('shows a corrected page’s own text, with As transcribed folded under it', () => {
    row(
      page({
        transcript: 'Valve shut 4 metres',
        original: 'Valve shut 4 m',
        uncertain: [[11, 14]],
        correction: { at: '2026-11-18T08:00:00Z', by: { id: 'u', name: 'Alex Rowe' } },
      }),
    )
    expect(screen.queryByText(/unsure/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show text' }))
    expect(screen.getByText('Valve shut 4 metres')).toBeInTheDocument()
    expect(screen.getByText('As transcribed').closest('details')).not.toBeNull()
  })
})
