// Background work (F-11): the header's activity icon and its popover, against
// a stubbed GET /api/background-work.
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivityButton } from './components/ActivityButton'
import type { BackgroundWorkRow } from './api'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// Answers GET /api/background-work with these rows.
function serve(rows: BackgroundWorkRow[]) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
    String(input).startsWith('/api/background-work')
      ? json({ rows })
      : Promise.reject(new TypeError('Failed to fetch')),
  )
}

const walk: BackgroundWorkRow = {
  id: 'walk:w1',
  kind: 'walk',
  state: 'running',
  title: 'Morning walk',
  context: { label: 'Jurong Cold Store', reference: 'RPT-2026-0913' },
  progress: { type: 'stages', current: 1, total: 2, unit: 'recordings' },
  href: '/assessment?ref=RPT-2026-0913&tab=observations&walk=w1',
}

describe('the activity icon', () => {
  it('is not shown while nothing is running, failed or waiting', async () => {
    serve([])

    render(<ActivityButton />)

    // Give the read a chance to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('button', { name: /background work/i })).not.toBeInTheDocument()
  })

  it('stays hidden, without breaking the header, when the answer has no rows', async () => {
    vi.stubGlobal('fetch', () => json({}))

    // A neighbour, as the bell is: a crash here would take the whole header with it.
    render(
      <header>
        <ActivityButton />
        <button>Notifications</button>
      </header>,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /background work/i })).not.toBeInTheDocument()
  })

  it('is shown, without a count badge, when work is running', async () => {
    serve([walk])

    render(<ActivityButton />)

    const button = await screen.findByRole('button', { name: 'Background work, 1 running' })
    // Red counts are the Inbox's and the bell's (design system).
    expect(button.querySelector('.notif-badge')).toBeNull()
  })
})
