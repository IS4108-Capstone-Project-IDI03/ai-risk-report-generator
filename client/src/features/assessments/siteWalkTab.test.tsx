// Tests for the site walk parts of the Observations tab (CP-22 AC5, review fixes):
// the Site Walk Proposals screen, Retry on a failed walk, the "site walk ready"
// notification opening the review, and where each Back goes.
// Covers screens/SiteWalks.tsx, WalkTabs.tsx, NavigatorFoot.tsx, screens/Observations.tsx and notifications/NotificationBell.tsx.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { SiteWalk } from '../site-walk/api'
import type { SavedObservation } from './api'

const REF = 'RPT-2026-0411'
const WALKS = `/api/assessments/${REF}/site-walks`
const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const walk = (fields: Partial<SiteWalk> = {}): SiteWalk => ({
  id: 'w1',
  status: 'failed',
  name: null,
  createdAt: '2026-10-29T08:00:00.000Z',
  recordings: [],
  photos: [],
  notes: [],
  typedText: null,
  proposal: null,
  error: null,
  ...fields,
})
const READY = walk({
  status: 'ready',
  proposal: {
    locations: [],
    observations: [
      {
        ref: 'o1',
        note: 'Coils iced over.',
        copeDimension: null,
        severity: null,
        locationRef: null,
        recordingSeq: null,
        start: null,
        end: null,
        photoIds: [],
        check: { severity: false, category: false, location: false },
      },
    ],
  },
})

let walks: SiteWalk[]
let calls: string[]
// The assessment's saved observations, when a test needs some.
let observations: SavedObservation[] | null
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  walks = []
  calls = []
  observations = null
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push((init.method ?? 'GET') + ' ' + url)
    // Continue on a recording walk starts or resumes it.
    if (url === WALKS && init.method === 'POST') return json(200, walks[0])
    if (url === WALKS) return json(200, walks)
    if (url === `${WALKS}/w1/retry`) {
      walks = [walk({ status: 'proposing' })]
      return json(200, walks[0])
    }
    if (url === `${WALKS}/w1`) return json(200, walks[0])
    // The tab lists deleted ones too, for the Deleted button's count.
    if (observations && url.startsWith(`/api/assessments/${REF}/observations`))
      return json(200, observations)
    // The review loads the assessment's locations for "Use an existing location".
    if (url === `/api/assessments/${REF}/locations`)
      return json(200, observations ? [observations[0].location] : [])
    if (url.startsWith('/api/notifications?'))
      return json(200, {
        items: [
          {
            id: 'n1',
            purpose: 'site_walk_ready',
            message: 'Your site walk is ready',
            details: null,
            context: { reference: REF, walkId: 'w1' },
            read: false,
            createdAt: '2026-10-29T09:00:00.000Z',
          },
        ],
        total: 1,
        unread: 1,
      })
    return Promise.reject(new TypeError('Failed to fetch'))
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openApp() {
  window.history.replaceState(null, '', '/')
  render(<App />)
  await signIn()
}
async function openObservations() {
  await openApp()
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
}

// The Observations toolbar's button opens the Site Walk Proposals screen.
const openWalksScreen = async (name: string | RegExp = /^Site walk proposals/) => {
  fireEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('navigation', LIST)
}
// The list screen is known by its tab bar.
const LIST = { name: 'Site walk proposals' }
// The review is titled by the walk's name alone; READY has no places, so it is "Site walk".
const reviewHeading = () => screen.findByRole('heading', { name: 'Site walk' })

describe('The Site Walk Proposals screen, opened from the Observations toolbar', () => {
  it('groups each walk, newest first, with its state in words', async () => {
    walks = [
      walk({ id: 'a', status: 'transcribing', createdAt: '2026-10-29T08:00:00.000Z' }),
      walk({
        id: 'b',
        status: 'proposing',
        createdAt: '2026-10-30T08:00:00.000Z',
        // Only the counts are read here.
        recordings: [{}] as never,
        notes: [{}] as never,
        photos: [{}] as never,
      }),
      READY,
      walk({ id: 'c', status: 'recording', createdAt: '2026-10-28T08:00:00.000Z' }),
    ]
    await openObservations()
    // The button's visible label is the words "Site walk proposals", before the count.
    const toolbar = await screen.findByRole('button', {
      name: 'Site walk proposals, 1 ready to review',
    })
    expect(toolbar).toHaveTextContent(/^Site walk proposals/)
    expect(toolbar.querySelector('.ob-pill')).toHaveTextContent('1')
    const nav = within(await openWalksScreen('Site walk proposals, 1 ready to review'))
    expect(screen.getByRole('heading', { name: 'Site Walk Proposals' })).toBeInTheDocument()
    expect(nav.getByRole('button', { name: /^Ready to review/ })).toHaveTextContent('1')
    expect(nav.getByRole('button', { name: /^In progress/ })).toHaveTextContent('3')

    // Ready to review opens first; the incomplete observation shows as a count to fix.
    const ready = screen.getAllByRole('listitem').filter((li) => li.classList.contains('wr'))
    expect(ready).toHaveLength(1)
    expect(within(ready[0]).getByRole('button', { name: /1 to fix$/ })).toBeInTheDocument()

    // In progress: the rest, newest first, each in its own words.
    fireEvent.click(nav.getByRole('button', { name: /^In progress/ }))
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('wr'))
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByRole('button', { name: /Reading your walk$/ })).toBeInTheDocument()
    expect(within(rows[1]).getByRole('button', { name: /Transcribing$/ })).toBeInTheDocument()
    expect(within(rows[2]).getByRole('button', { name: /Recording$/ })).toBeInTheDocument()
    // Named the one way every walk is: its places, else "Site walk", with its time.
    expect(rows[0]).toHaveTextContent(/^Site walk\w{3} \d{1,2} \w{3}, \d{2}:\d{2}/)
  })

  it('shows a failed walk with Retry, which tries it again', async () => {
    walks = [walk({ error: 'The recording could not be transcribed.' })]
    await openObservations()
    await openWalksScreen('Site walk proposals (1)')
    expect(screen.getByText('The recording could not be transcribed.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry Site walk' }))
    expect(await screen.findByRole('button', { name: /Reading your walk$/ })).toBeInTheDocument()
    expect(calls).toContain(`POST ${WALKS}/w1/retry`)
    expect(await screen.findByRole('status')).toHaveTextContent('Reading the walk again')
  })

  it('deletes a proposal after the confirmation, and says so', async () => {
    walks = [READY]
    await openObservations()
    await openWalksScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Site walk' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Delete this proposal?' }))
    expect(dialog.getByText(/1 proposed observation/)).toBeInTheDocument()
    walks = []
    fireEvent.click(dialog.getByRole('button', { name: 'Delete proposal' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Proposal deleted')
    expect(calls).toContain(`DELETE ${WALKS}/w1`)
  })

  it('opens the review from a ready walk', async () => {
    walks = [READY]
    await openObservations()
    await openWalksScreen()
    fireEvent.click(screen.getByRole('button', { name: /^Review/ }))
    expect(await reviewHeading()).toBeInTheDocument()
    // The review says what is left to fix before Create all.
    expect(
      screen.getByRole('button', { name: /^Not ready: 1 observation needs details/ }),
    ).toBeInTheDocument()
  })

  it('leads Back from a review opened in the list to the list', async () => {
    walks = [READY]
    await openObservations()
    await openWalksScreen()
    fireEvent.click(screen.getByRole('button', { name: /^Review/ }))
    await reviewHeading()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Site walk proposals' }))
    expect(await screen.findByRole('navigation', LIST)).toBeInTheDocument()
  })

  it('leads Back from a proposed observation to its review', async () => {
    walks = [READY]
    await openObservations()
    await openWalksScreen()
    fireEvent.click(screen.getByRole('button', { name: /^Review/ }))
    await reviewHeading()
    fireEvent.click(screen.getByRole('button', { name: /Coils iced over/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Site walk' }))
    expect(
      await screen.findByRole('button', { name: 'Back to Site walk proposals' }),
    ).toBeInTheDocument()
  })

  it('leads Back from a recording opened in the list to the list', async () => {
    walks = [walk({ id: 'w1', status: 'recording' })]
    await openObservations()
    await openWalksScreen()
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Site walk proposals' }))
    expect(await screen.findByRole('navigation', LIST)).toBeInTheDocument()
  })

  it('has no Walks button when the engineer has no walk', async () => {
    await openObservations()
    await screen.findByRole('navigation', { name: 'Locations' })
    expect(screen.queryByRole('button', { name: /^Site walk proposals/ })).toBeNull()
    expect(screen.queryByRole('navigation', LIST)).toBeNull()
  })

  it('keeps site walks out of the location navigator', async () => {
    walks = [READY]
    await openObservations()
    const nav = await screen.findByRole('navigation', { name: 'Locations' })
    expect(within(nav).queryByText(/Walk · /)).toBeNull()
  })
})

describe('Version history (and Archive, for the owner) on the Observations tab', () => {
  it('is a pill group in the header, not in the navigator’s foot', async () => {
    await openObservations()
    const nav = await screen.findByRole('navigation', { name: 'Locations' })
    const group = screen.getByRole('group', { name: 'Assessment' })
    expect(within(group).getByRole('button', { name: 'History' })).toHaveAttribute(
      'title',
      'Version history',
    )
    expect(within(nav).queryByRole('button', { name: /History|Archive/ })).toBeNull()
  })

  it('is in the header on the other tabs too', async () => {
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    const group = screen.getByRole('group', { name: 'Assessment' })
    expect(within(group).getByRole('button', { name: 'History' })).toBeInTheDocument()
  })
})

describe('The "site walk ready" notification', () => {
  it('opens that assessment’s Observations tab on the walk’s review', async () => {
    walks = [READY]
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Your site walk is ready' }))

    expect(await reviewHeading()).toBeInTheDocument()
  })

  it('leads Back to the Observations tab it opened over', async () => {
    walks = [READY]
    await openObservations()
    await screen.findByRole('navigation', { name: 'Locations' })
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Your site walk is ready' }))
    await reviewHeading()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Observations' }))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Site walk' })).toBeNull()
      expect(screen.getByRole('navigation', { name: 'Locations' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('navigation', LIST)).toBeNull()
  })

  it('leads Back to the list when it opened over the list', async () => {
    walks = [READY]
    await openObservations()
    await openWalksScreen()
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Your site walk is ready' }))
    await reviewHeading()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Site walk proposals' }))
    expect(await screen.findByRole('navigation', LIST)).toBeInTheDocument()
  })
})

describe('An observation created from a site walk proposal', () => {
  const saved = (fields: Partial<SavedObservation>): SavedObservation => ({
    id: 'o1',
    engineer: 'Alex Rowe',
    copeDimensions: ['Protection'],
    standard: null,
    severity: 'high',
    location: { id: 'l1', building: 'Warehouse', name: 'Bay 3 — north aisle', floor: 'Ground' },
    note: 'Hose reel blocked by pallets.',
    recordings: [],
    photos: [],
    removedRecordings: [],
    removedPhotos: [],
    interpretation: null,
    recordedAt: '2026-11-02T08:10:00.000Z',
    edited: null,
    deleted: null,
    ...fields,
  })

  it('is marked "From site walk" on its row and its page; one saved by hand is not', async () => {
    observations = [
      saved({ fromSiteWalk: true }),
      saved({ id: 'o2', note: 'Exit sign out.', fromSiteWalk: false }),
    ]
    await openObservations()
    const fromWalk = (await screen.findByText('Hose reel blocked by pallets.')).closest('button')!
    const byHand = screen.getByText('Exit sign out.').closest('button')!
    // An icon-only mark (screen-reader label) on the category tile's corner, not a pill in the text.
    const mark = within(fromWalk).getByText('From site walk')
    expect(mark.closest('.ob-cat-flag')).not.toBeNull()
    expect(mark.closest('.ob-row-text')).toBeNull()
    expect(within(byHand).queryByText('From site walk')).toBeNull()

    fireEvent.click(fromWalk)
    expect(await screen.findByText('From site walk')).toBeInTheDocument()
  })
})
