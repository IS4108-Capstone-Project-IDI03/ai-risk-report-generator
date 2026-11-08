// The admin's Assessments list and Reassign (RV-11 AC3, AC7, AC9, AC10): an Engineer column and a
// Reassign row icon for admins only, a dialog that picks the new engineer, and an archived
// assessment that says why it can't move.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { calls, created, gateway, json, sent } from '../new-assessment/testKit'

const ALEX = { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' }
const OMAR = { id: '6ab39017e45cf009e4507735', name: 'Omar Khan' }
const SANA = { id: '6ab39017e45cf009e4507734', name: 'Sana Patel' }
const PEOPLE = {
  items: [
    { ...ALEX, role: 'risk_engineer' },
    { ...OMAR, role: 'knowledge_admin' },
    { ...SANA, role: 'knowledge_admin' },
  ],
}
const row = (reference: string, site: string, extra = {}) => ({
  ...created(reference, site),
  clientId: 'c1',
  ...extra,
})
const LIST = [
  row('RPT-2026-0001', 'Jurong Island Depot'),
  row('RPT-2026-0002', 'Tuas Cold Store', { status: 'archived' }),
]
const rowOf = (reference: string) =>
  document.querySelector<HTMLElement>(`.at-row[data-id="${reference}"]`)!

function serve(extra: Record<string, () => Promise<Response> | Response> = {}) {
  gateway({
    'GET /api/assessments': () => json(200, LIST),
    'GET /api/assessments/assignable-engineers': () => json(200, PEOPLE),
    ...extra,
  })
}
async function openList(role: 'knowledge_admin' | 'risk_engineer') {
  window.history.pushState({}, '', '/assessments')
  render(<App />)
  await signIn(role)
  await screen.findByText('RPT-2026-0001')
}
const reassignButton = (reference: string) =>
  screen.getByRole('button', { name: 'Reassign ' + reference })
const dialog = () => screen.getByRole('dialog', { name: /^Reassign/ })

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('Assessments list for an admin (RV-11)', () => {
  it('lists everyone’s assessments with their engineer in a column (AC3)', async () => {
    serve()
    await openList('knowledge_admin')
    expect(screen.getByText('Engineer', { selector: '.at-head span' })).toBeInTheDocument()
    expect(within(rowOf('RPT-2026-0001')).getByText('Alex Rowe')).toBeInTheDocument()
  })

  it('gives an engineer no Engineer column and no Reassign (AC10)', async () => {
    serve()
    await openList('risk_engineer')
    expect(screen.queryByText('Engineer', { selector: '.at-head span' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reassign/ })).not.toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('assignable-engineers'))).toBe(false)
  })
})

describe('Reassign (RV-11)', () => {
  it('asks for a new engineer, leaving out the current one, with none chosen (AC7)', async () => {
    serve()
    await openList('knowledge_admin')
    fireEvent.click(reassignButton('RPT-2026-0001'))

    expect(dialog()).toHaveTextContent('Reassign RPT-2026-0001')
    expect(dialog()).toHaveTextContent(
      'Observations and drafts stay with the assessment. The new engineer gets it in their Inbox, and Alex Rowe is told it moved.',
    )
    const picker = within(dialog()).getByRole('button', { name: /^Assigned engineer/ })
    expect(picker).toHaveTextContent('Choose')
    fireEvent.click(picker)
    await screen.findByRole('menuitemradio', { name: /^Omar Khan/ })
    expect(screen.getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual([
      'SPMeAdmin',
      'OKOmar KhanAdmin',
    ])
  })

  it('needs a choice before it moves anything', async () => {
    serve()
    await openList('knowledge_admin')
    fireEvent.click(reassignButton('RPT-2026-0001'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reassign' }))

    expect(within(dialog()).getByText('Choose an engineer')).toBeInTheDocument()
    expect(sent('POST', '/api/assessments/RPT-2026-0001/reassign')).toHaveLength(0)
    // The field takes the focus, so the keyboard and the screen reader land on what's missing.
    expect(within(dialog()).getByRole('button', { name: /^Assigned engineer/ })).toHaveFocus()
    // Landing on it says why: the error is the field's description, and the star isn't read out.
    const field = within(dialog()).getByRole('button', { name: /^Assigned engineer/ })
    expect(field).toHaveAccessibleDescription('Choose an engineer')
    expect(field).toHaveAccessibleName('Assigned engineer Choose')
  })

  it('tells nobody it moved when the assessment has no engineer yet', async () => {
    serve({ 'GET /api/assessments': () => json(200, [{ ...LIST[0], engineer: null }, LIST[1]]) })
    await openList('knowledge_admin')
    fireEvent.click(reassignButton('RPT-2026-0001'))
    expect(dialog()).toHaveTextContent(
      'Observations and drafts stay with the assessment. The new engineer gets it in their Inbox.',
    )
    expect(dialog()).not.toHaveTextContent('told it moved')
  })

  it("shows the gateway's words and refreshes the row when another admin moved it first", async () => {
    let moved = false
    const words = 'This assessment was just reassigned. Reload and try again.'
    serve({
      'GET /api/assessments': () =>
        json(
          200,
          moved
            ? [{ ...LIST[0], engineer: { id: 'u-jordan', name: 'Jordan Lee' } }, LIST[1]]
            : LIST,
        ),
      'POST /api/assessments/RPT-2026-0001/reassign': () => {
        moved = true
        return json(409, { error: words })
      },
    })
    await openList('knowledge_admin')
    fireEvent.click(reassignButton('RPT-2026-0001'))
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Assigned engineer/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Omar Khan/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reassign' }))

    expect(await within(dialog()).findByText(words)).toBeInTheDocument()
    await waitFor(() =>
      expect(within(rowOf('RPT-2026-0001')).getByText('Jordan Lee')).toBeVisible(),
    )
    // The dialog names who holds it now.
    expect(dialog()).toHaveTextContent('Jordan Lee is told it moved')
  })

  it('moves it, updates the row and says so (AC7)', async () => {
    serve({
      'POST /api/assessments/RPT-2026-0001/reassign': () =>
        json(200, row('RPT-2026-0001', 'Jurong Island Depot', { engineer: OMAR })),
    })
    await openList('knowledge_admin')
    fireEvent.click(reassignButton('RPT-2026-0001'))
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Assigned engineer/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Omar Khan/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reassign' }))

    await waitFor(() =>
      expect(within(rowOf('RPT-2026-0001')).getByText('Omar Khan')).toBeInTheDocument(),
    )
    expect(sent('POST', '/api/assessments/RPT-2026-0001/reassign')[0].body).toEqual({
      engineerId: OMAR.id,
    })
    expect(screen.queryByRole('dialog', { name: /^Reassign/ })).not.toBeInTheDocument()
    expect(await screen.findByText('RPT-2026-0001 reassigned')).toBeInTheDocument()
    expect(screen.getByText('Now with Omar Khan')).toBeInTheDocument()
    // The row holds the "just changed" tint while it settles.
    expect(rowOf('RPT-2026-0001')).toHaveAttribute('data-changed')
  })

  it('keeps the dialog open with the reason when it fails', async () => {
    serve({
      'POST /api/assessments/RPT-2026-0001/reassign': () =>
        json(500, { error: 'Something broke.' }),
    })
    await openList('knowledge_admin')
    fireEvent.click(reassignButton('RPT-2026-0001'))
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Assigned engineer/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Omar Khan/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reassign' }))

    expect(await within(dialog()).findByText('Something broke.')).toBeInTheDocument()
    expect(within(rowOf('RPT-2026-0001')).getByText('Alex Rowe')).toBeInTheDocument()
  })

  it('says so and refreshes the row when it was archived since the page loaded', async () => {
    let archived = false
    serve({
      'GET /api/assessments': () =>
        json(200, archived ? [{ ...LIST[0], status: 'archived' }, LIST[1]] : LIST),
      'POST /api/assessments/RPT-2026-0001/reassign': () => {
        archived = true
        return json(409, { error: 'An archived assessment cannot be reassigned.' })
      },
    })
    await openList('knowledge_admin')
    fireEvent.click(reassignButton('RPT-2026-0001'))
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Assigned engineer/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Omar Khan/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reassign' }))

    expect(
      await within(dialog()).findByText(/archived since you opened this page/i),
    ).toBeInTheDocument()
    // The list is read again: an archived row is no longer on the default list.
    await waitFor(() => expect(rowOf('RPT-2026-0001')).toBeNull())
  })

  it('greys the icon for an archived assessment and says why instead of opening (AC9)', async () => {
    serve()
    await openList('knowledge_admin')
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Archived' }))
    const icon = await screen.findByRole('button', { name: 'Reassign RPT-2026-0002' })

    expect(icon).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(icon)
    expect(screen.queryByRole('dialog', { name: /^Reassign/ })).not.toBeInTheDocument()
    const reason = screen.getByRole('tooltip')
    expect(reason).toHaveTextContent("Can't reassign yet")
    expect(reason).toHaveTextContent('This assessment is archived. Restore it first.')
  })
})
