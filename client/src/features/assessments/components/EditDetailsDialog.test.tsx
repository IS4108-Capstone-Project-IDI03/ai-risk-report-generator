// Edit Assessment Details on design system v2 (AS-06 round 9): the v2 shell, date pickers, a save
// that sends nothing when nothing changed, and a report due date that cannot precede the survey.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Assessment } from '../api'
import { EditDetailsDialog } from './EditDetailsDialog'

beforeAll(() => {
  // jsdom has no native modal implementation.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const RECORD = {
  reference: 'RPT-2026-0072',
  client: 'Harbourline Properties Pte Ltd',
  surveyType: 'First survey',
  siteVisitDate: '2026-11-11',
  reportDueDate: '2026-12-16',
  site: { name: 'Pasir Gudang Cold Store' },
} as unknown as Assessment

const puts: { body: Record<string, unknown> }[] = []
function open(reply: () => Response = () => new Response(null, { status: 204 })) {
  puts.length = 0
  vi.stubGlobal('fetch', (_: string, init?: RequestInit) => {
    puts.push({ body: JSON.parse(String(init?.body ?? '{}')) })
    return Promise.resolve(reply())
  })
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<EditDetailsDialog record={RECORD} onClose={onClose} onSaved={onSaved} />)
  const dialog = screen.getByRole('dialog', { name: 'Edit Assessment Details' })
  return { dialog: within(dialog), root: dialog, onClose, onSaved }
}
const type = (field: HTMLElement, text: string) =>
  fireEvent.change(field, { target: { value: text } })

describe('the Edit Assessment Details dialog', () => {
  it('wears the v2 dialog shell, with pill buttons and dates as dd/mm/yyyy', () => {
    const { dialog, root } = open()
    expect(root).toHaveClass('ds-dialog--v2')
    expect(root).toHaveStyle({ width: '520px' })
    expect(dialog.getByLabelText(/Survey Date/)).toHaveValue('11/11/2026')
    expect(dialog.getByLabelText(/Report Due Date/)).toHaveValue('16/12/2026')
    expect(dialog.getByLabelText(/Assessment Type/)).toHaveValue('First survey')
    for (const name of ['Cancel', 'Save Changes'])
      expect(dialog.getByRole('button', { name }).style.borderRadius).toBe('var(--radius-pill)')
    // The date inputs are the picker's text fields, not the browser's native date inputs.
    expect(root.querySelector('input[type="date"]')).toBeNull()
  })

  it('closes at once, sending nothing, when Save is pressed with nothing changed', () => {
    const { dialog, onClose, onSaved } = open()
    fireEvent.click(dialog.getByRole('button', { name: 'Save Changes' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(puts).toHaveLength(0)
  })

  it('refuses a report due date before the survey start, with the form’s own line', () => {
    const { dialog } = open()
    type(dialog.getByLabelText(/Report Due Date/), '10/11/2026')
    expect(
      dialog.getByText('Pick a date on or after 11/11/2026, the survey start.'),
    ).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Save Changes' }))
    expect(puts).toHaveLength(0)
  })

  it('greys Save while a date is wrong, with no second box over the line that says why', () => {
    const { dialog } = open()
    type(dialog.getByLabelText(/Report Due Date/), '10/11/2026')
    const save = dialog.getByRole('button', { name: 'Save Changes' })
    expect(save).toBeDisabled()
    fireEvent.focus(save)
    expect(dialog.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('says a typed date that is not a real one is not, and does not save it', () => {
    const { dialog } = open()
    type(dialog.getByLabelText(/Report Due Date/), '31/02/2026')
    expect(dialog.getByText('Enter a date as dd/mm/yyyy')).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'Save Changes' }))
    expect(puts).toHaveLength(0)
  })

  it('saves the changed details as ISO dates and tells its opener', async () => {
    const { dialog, onSaved } = open()
    type(dialog.getByLabelText(/Report Due Date/), '20/12/2026')
    fireEvent.change(dialog.getByLabelText(/Assessment Type/), { target: { value: 'Resurvey' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(puts[0].body).toEqual({
      surveyType: 'Resurvey',
      siteVisitDate: '2026-11-11',
      // Sent with the rest so a save never clears it (CP-60); this record has none.
      siteVisitEndDate: '',
      reportDueDate: '2026-12-20',
    })
  })

  it('keeps what was typed and names the field when the gateway refuses it', async () => {
    const { dialog } = open(
      () =>
        new Response(
          JSON.stringify({ error: 'invalid', fields: { reportDueDate: 'Not on a Sunday.' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    type(dialog.getByLabelText(/Report Due Date/), '20/12/2026')
    fireEvent.click(dialog.getByRole('button', { name: 'Save Changes' }))
    expect(await dialog.findByText('Not on a Sunday.', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(dialog.getByLabelText(/Report Due Date/)).toHaveValue('20/12/2026')
  })

  it('lets the next try go through after the gateway refused a date', async () => {
    let refuse = true
    const { dialog, onSaved } = open(() =>
      refuse
        ? new Response(
            JSON.stringify({ error: 'invalid', fields: { reportDueDate: 'Not on a Sunday.' } }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        : new Response(null, { status: 204 }),
    )
    type(dialog.getByLabelText(/Report Due Date/), '20/12/2026')
    fireEvent.click(dialog.getByRole('button', { name: 'Save Changes' }))
    await dialog.findByText('Not on a Sunday.', {}, { timeout: 3000 })
    refuse = false
    type(dialog.getByLabelText(/Report Due Date/), '21/12/2026')
    fireEvent.click(dialog.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('shows a day picked in the calendar, and Save sends that day', async () => {
    const { dialog, onSaved } = open()
    fireEvent.click(dialog.getByLabelText(/Report Due Date/))
    fireEvent.click(dialog.getByRole('button', { name: /20 December 2026/ }))
    expect(dialog.getByLabelText(/Report Due Date/)).toHaveValue('20/12/2026')
    fireEvent.click(dialog.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(puts[0].body).toMatchObject({ reportDueDate: '2026-12-20' })
  })

  it('closes from Cancel without saving', () => {
    const { dialog, onClose } = open()
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(puts).toHaveLength(0)
  })
})
