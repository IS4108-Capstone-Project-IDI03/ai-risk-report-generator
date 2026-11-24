// Background work (F-11): the header's activity icon and its popover, against
// a stubbed GET /api/background-work.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityButton } from './components/ActivityButton'
import type { BackgroundWorkRow } from './api'
import { announceBackgroundWork } from './started'
import { assessmentPlace } from '../assessments/openAssessment'
import { siteWalkReview } from '../site-walk/openReview'
import { knowledgeTab } from '../knowledge-base/openTab'

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

// Answers GET /api/background-work with these rows; returns how many reads were made.
function serve(rows: BackgroundWorkRow[]) {
  const reads = { count: 0 }
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    if (!String(input).startsWith('/api/background-work'))
      return Promise.reject(new TypeError('Failed to fetch'))
    reads.count++
    return json({ rows })
  })
  return reads
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

// Opens the popover over these rows; returns it.
async function openWith(rows: BackgroundWorkRow[]) {
  serve(rows)
  render(<ActivityButton />)
  fireEvent.click(await screen.findByRole('button', { name: /^Background work/ }))
  return screen.findByRole('dialog', { name: 'Background work' })
}

describe('the popover', () => {
  it('lists each job with what it belongs to', async () => {
    const popover = await openWith([walk])

    const row = within(popover).getByRole('listitem')
    expect(within(row).getByText('Morning walk')).toBeInTheDocument()
    expect(within(row).getByText('Jurong Cold Store')).toBeInTheDocument()
  })

  it('shows a document being ingested by its stage, with a bar of the real pages done', async () => {
    const popover = await openWith([
      {
        id: 'ingestion:d1',
        kind: 'ingestion',
        state: 'running',
        title: 'FM 8-9',
        context: { label: 'Knowledge base' },
        progress: {
          type: 'count',
          current: 12,
          total: 40,
          unit: 'pages',
          stage: 'Chunking',
          step: 2,
          steps: 3,
        },
        href: '/admin/knowledge-base',
      },
    ])

    expect(within(popover).getByText('Stage 2 of 3 · Chunking')).toBeInTheDocument()
    expect(within(popover).getByText('12 of 40 pages')).toBeInTheDocument()
    expect(within(popover).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')
  })

  it('shows recordings or parts as one segment each, with the real count', async () => {
    const popover = await openWith([walk])

    expect(within(popover).getByText('recordings')).toBeInTheDocument()
    const segments = popover.querySelectorAll('.ds-seg')
    expect([...segments].map((s) => s.getAttribute('data-state'))).toEqual(['done', 'working'])
    expect(within(popover).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  describe('timed by the minute', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-24T09:03:20Z'))
    })
    afterEach(() => vi.useRealTimers())

    it('shows one AI call as working, with its step and how long it has run', async () => {
      const popover = await openWith([
        {
          ...walk,
          id: 'reading:o1',
          kind: 'reading',
          title: 'Observation',
          progress: { type: 'working', stage: 'Describing photos' },
          startedAt: '2026-11-24T09:00:00Z',
        },
      ])

      expect(within(popover).getByRole('img', { name: 'Working' })).toBeInTheDocument()
      expect(within(popover).getByText('Describing photos · 3 min')).toBeInTheDocument()
      expect(within(popover).queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('says a queued job is queued, and for how long', async () => {
      const popover = await openWith([
        {
          ...walk,
          state: 'queued',
          progress: { type: 'working', stage: 'Queued' },
          startedAt: '2026-11-24T09:00:00Z',
        },
      ])

      expect(within(popover).getByText('Queued · 3 min')).toBeInTheDocument()
    })
  })

  it('puts what waits on you first, under its own heading, saying what to do', async () => {
    const decision: BackgroundWorkRow = {
      id: 'document-decision:d2',
      kind: 'document-decision',
      state: 'waiting_on_you',
      title: 'Site guide',
      context: { label: 'Knowledge base' },
      progress: { type: 'working', stage: 'Choose its source type' },
      href: '/admin/knowledge-base',
    }
    const popover = await openWith([walk, decision])

    const groups = within(popover).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Waiting on you',
      'In progress',
    ])
    expect(within(groups[0]).getByText('Site guide')).toBeInTheDocument()
    expect(within(groups[0]).getByText('Choose its source type')).toBeInTheDocument()
    expect(within(groups[1]).getByText('Morning walk')).toBeInTheDocument()
  })
})

describe('keeping up to date', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  // Lets the read in flight land.
  const settle = () => act(() => vi.advanceTimersByTimeAsync(0))
  const failedWalk: BackgroundWorkRow = { ...walk, state: 'failed', error: 'No speech.' }

  it('reads again every 5 seconds while work runs', async () => {
    const reads = serve([walk])
    render(<ActivityButton />)
    await settle()

    await act(() => vi.advanceTimersByTimeAsync(5_000))

    expect(reads.count).toBe(2)
  })

  it('reads only every 30 seconds while nothing runs', async () => {
    const reads = serve([failedWalk])
    render(<ActivityButton />)
    await settle()

    await act(() => vi.advanceTimersByTimeAsync(29_000))
    expect(reads.count).toBe(1)
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(reads.count).toBe(2)
  })

  it('reads at once when the person starts a job, not at the next 30-second read', async () => {
    const reads = serve([])
    render(<ActivityButton />)
    await settle()

    announceBackgroundWork()
    await settle()

    expect(reads.count).toBe(2)
  })

  it('reads again when the popover opens', async () => {
    const reads = serve([failedWalk])
    render(<ActivityButton />)
    await settle()

    fireEvent.click(screen.getByRole('button', { name: /^Background work/ }))
    await settle()

    expect(reads.count).toBe(2)
  })
})

describe('acting on a row', () => {
  // Records the detail of each `event` the app is asked to follow.
  function heard(event: string) {
    const details: unknown[] = []
    const listen = (e: Event) => details.push((e as CustomEvent).detail)
    window.addEventListener(event, listen)
    afterEach(() => window.removeEventListener(event, listen))
    return details
  }

  it("opens a walk's review", async () => {
    const opened = heard(siteWalkReview.event)
    const popover = await openWith([walk])

    fireEvent.click(within(popover).getByRole('button', { name: /Morning walk/ }))

    expect(opened).toEqual([{ reference: 'RPT-2026-0913', walkId: 'w1' }])
  })

  it('opens the observation a reading or transcription belongs to', async () => {
    const opened = heard(assessmentPlace.event)
    const popover = await openWith([
      {
        ...walk,
        id: 'reading:o1',
        kind: 'reading',
        title: 'Observation',
        progress: { type: 'working', stage: 'Describing photos' },
        href: '/assessment?ref=RPT-2026-0913&tab=observations&obs=o1',
      },
    ])

    fireEvent.click(within(popover).getByRole('button', { name: /Observation/ }))

    expect(opened).toEqual([{ reference: 'RPT-2026-0913', tab: 'observations', obs: 'o1' }])
  })
})

// Written after openWork's knowledge branches (F-11 T18), so these passed from the start.
describe('acting on a knowledge row', () => {
  afterEach(() => window.history.pushState(null, '', '/'))

  it("opens a document's Review page for a decision waiting on the admin", async () => {
    const popover = await openWith([
      {
        id: 'document-decision:d1',
        kind: 'document-decision',
        state: 'waiting_on_you',
        title: 'FM 8-9',
        context: { label: 'Knowledge base' },
        progress: { type: 'working', stage: 'Confirm its details' },
        href: '/admin/knowledge-base/review/d1',
      },
    ])

    fireEvent.click(within(popover).getByRole('button', { name: /FM 8-9/ }))

    expect(window.location.pathname).toBe('/admin/knowledge-base/review/d1')
  })

  const ingestion: BackgroundWorkRow = {
    id: 'ingestion:d1',
    kind: 'ingestion',
    state: 'queued',
    title: 'FM 8-9',
    context: { label: 'Knowledge base' },
    progress: { type: 'working', stage: 'Queued' },
    href: '/admin/knowledge-base',
  }

  it("opens the uploads for an admin's document being ingested", async () => {
    const popover = await openWith([ingestion])

    fireEvent.click(within(popover).getByRole('button', { name: /FM 8-9/ }))

    expect(knowledgeTab.current).toBe('add')
  })

  it("opens the documents for an engineer's request, since adding them is the admins'", async () => {
    const popover = await openWith([{ ...ingestion, id: 'request:r1:d1', kind: 'request' }])

    fireEvent.click(within(popover).getByRole('button', { name: /FM 8-9/ }))

    expect(knowledgeTab.current).toBe('documents')
  })
})

describe('a failed job', () => {
  // Records the detail of each `event` the app is asked to follow.
  function heardOnce(event: string) {
    const details: unknown[] = []
    const listen = (e: Event) => details.push((e as CustomEvent).detail)
    window.addEventListener(event, listen)
    afterEach(() => window.removeEventListener(event, listen))
    return details
  }

  const failed: BackgroundWorkRow = {
    ...walk,
    state: 'failed',
    error: 'A recording could not be transcribed.',
    retry: { method: 'POST', url: '/api/assessments/RPT-2026-0913/site-walks/w1/retry' },
  }

  it('says why, and tries again by its own route, then reads the list again', async () => {
    // Try again stays in the popover: it must not open the job as the row does.
    const opened = heardOnce(siteWalkReview.event)
    // The walk is failed until Try again is accepted, then working.
    const posted: string[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/background-work') return json({ rows: posted.length ? [walk] : [failed] })
      if (init?.method === 'POST') {
        posted.push(url)
        return json({})
      }
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    render(<ActivityButton />)
    fireEvent.click(await screen.findByRole('button', { name: /^Background work/ }))
    const popover = await screen.findByRole('dialog', { name: 'Background work' })

    expect(within(popover).getByText('A recording could not be transcribed.')).toBeInTheDocument()
    fireEvent.click(within(popover).getByRole('button', { name: 'Try again' }))

    // The list read again shows the walk working, no longer failed.
    await waitFor(() =>
      expect(within(popover).queryByText('A recording could not be transcribed.')).toBeNull(),
    )
    expect(posted).toEqual(['/api/assessments/RPT-2026-0913/site-walks/w1/retry'])
    expect(opened).toEqual([])
  })

  it('opens its job when its reason is clicked, as the rest of the row does', async () => {
    const opened = heardOnce(siteWalkReview.event)
    const popover = await openWith([failed])

    fireEvent.click(within(popover).getByText('A recording could not be transcribed.'))

    expect(opened).toEqual([{ reference: 'RPT-2026-0913', walkId: 'w1' }])
  })

  it('keeps a long reason to one line, with the whole of it as its tooltip', async () => {
    const reason =
      "Client details couldn't be protected because the privacy service didn't respond in time, so nothing was sent to the AI model. Try again in a moment."
    const popover = await openWith([{ ...failed, error: reason }])

    const shown = within(popover).getByText(reason)
    expect(shown.closest('.bgw-row__error')).toHaveAttribute('title', reason)
    expect(shown).toHaveClass('bgw-row__reason')
  })

  it('offers no Try again where the user may not start it again', async () => {
    const popover = await openWith([{ ...failed, retry: undefined }])

    expect(within(popover).getByText('A recording could not be transcribed.')).toBeInTheDocument()
    expect(within(popover).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
