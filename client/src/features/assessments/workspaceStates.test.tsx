// The Assessments list and an assessment's workspace while the list loads, fails or lacks the
// assessment: these states replaced the old sample mode. Renders App with a stubbed gateway.
// Covers screens/Dashboard.tsx, components/WorkspaceState.tsx, AssessmentApp.tsx.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { created, gateway, json, sent } from '../new-assessment/testKit'

const REAL = created('RPT-2026-0100', 'Jurong Cold Store')
const COUNTS = { total: 0, unread: 0, inboxTodo: 0, newestInbox: null, newestBell: null }
const SAMPLE_NAMES = ['Tilbury Distribution Centre', 'Leeds Cold Store']

// What GET /api/assessments answers next; a test sets it.
let listReply: () => Promise<Response> | Response
const pending = () => new Promise<Response>(() => {})
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'))

function serve() {
  gateway({
    'GET /api/assessments': () => listReply(),
    'GET /api/notifications/count': () => json(200, COUNTS),
  })
}
async function open(url: string) {
  window.history.pushState({}, '', url)
  render(<App />)
  await signIn()
}
const reads = () => sent('GET', '/api/assessments').length
const noSampleRows = () => {
  for (const name of SAMPLE_NAMES) expect(screen.queryByText(name)).not.toBeInTheDocument()
  expect(document.querySelector('.at-row')).toBeNull()
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  listReply = () => json(200, [REAL])
  serve()
})

describe('Assessments list states', () => {
  it('shows only a loading status, never sample rows, while the list is read', async () => {
    listReply = pending
    await open('/assessments')
    expect(await screen.findByRole('status', { name: 'Loading assessments' })).toBeInTheDocument()
    noSampleRows()
  })

  it.each([
    ['the gateway cannot be reached', unreachable],
    ['the gateway answers 500', () => json(500, { error: 'boom' })],
  ])('says the list can’t load when %s, and Try again reads it again', async (_, failure) => {
    listReply = failure
    await open('/assessments')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Can’t load assessments')
    expect(alert).toHaveTextContent('Check your connection, then try again.')
    expect(screen.queryByRole('status', { name: 'Loading assessments' })).not.toBeInTheDocument()
    noSampleRows()
    const before = reads()

    listReply = () => json(200, [REAL])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('RPT-2026-0100')).toBeInTheDocument()
    expect(reads()).toBe(before + 1)
    expect(screen.queryByText('Can’t load assessments')).not.toBeInTheDocument()
  })
})

describe('Assessment workspace states', () => {
  it('lands on the Assessments list when no assessment is named', async () => {
    await open('/assessment')
    expect(await screen.findByText('RPT-2026-0100')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/assessments')
    expect(screen.getByRole('heading', { name: 'Assessments' })).toBeInTheDocument()
  })

  it('says an assessment isn’t on your list after reading the list twice, and goes back', async () => {
    await open('/assessment?ref=RPT-9999-0000')
    expect(await screen.findByText('This assessment isn’t on your list')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assessment not found' })).toBeInTheDocument()
    // The first read, then one more before giving up.
    expect(reads()).toBe(2)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to assessments' }))
    expect(await screen.findByText('RPT-2026-0100')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/assessments')
    expect(screen.queryByText('Assessment not found')).not.toBeInTheDocument()
  })

  it('opens an assessment missing from the first read but on the second', async () => {
    let read = 0
    listReply = () => json(200, ++read === 1 ? [] : [REAL])
    await open('/assessment?ref=RPT-2026-0100')
    expect(await screen.findByRole('tab', { name: /Overview/ })).toBeInTheDocument()
    expect(reads()).toBe(2)
    expect(screen.queryByText('Assessment not found')).not.toBeInTheDocument()
    expect(screen.queryByText('This assessment isn’t on your list')).not.toBeInTheDocument()
  })

  it('shows a loading state while the list is read', async () => {
    listReply = pending
    await open('/assessment?ref=RPT-2026-0100')
    expect(await screen.findByRole('status', { name: 'Loading assessment' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    noSampleRows()
  })

  it('says it can’t load the assessment when the list fails, and Try again recovers', async () => {
    listReply = unreachable
    await open('/assessment?ref=RPT-2026-0100')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Can’t load this assessment')
    expect(alert).toHaveTextContent('Check your connection, then try again.')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()

    listReply = () => json(200, [REAL])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('tab', { name: /Overview/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Can’t load this assessment')).toBeNull())
  })
})
