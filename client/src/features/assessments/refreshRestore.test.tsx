// Tests that a page refresh reopens where the engineer was (CP-22 round 3):
// the same assessment, tab and observation, never the demo default (Tilbury).
// Covers the URL sync in useAssessmentWorkflow.tsx.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { openProposalCapture } from '../site-walk/proposalCapture'

beforeEach(() => {
  // An unreachable gateway: the work list shows the demo assessments.
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
  window.history.pushState({}, '', '/assessments')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

// A refresh: the app mounts again on the URL the last one left.
async function refresh() {
  cleanup()
  render(<App />)
  await signIn()
}

it('reopens the same assessment and tab after a refresh', async () => {
  render(<App />)
  await signIn()
  fireEvent.click((await screen.findAllByRole('button', { name: /^Leeds Cold Store/ }))[0])
  fireEvent.click(screen.getByRole('tab', { name: /Checklist/ }))

  await refresh()

  expect(await screen.findByRole('tab', { name: /Checklist/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(screen.getByRole('heading', { level: 1, name: /Leeds Cold Store/ })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { level: 1, name: /Tilbury/ })).not.toBeInTheDocument()
})

it('reopens the observation that was open', async () => {
  render(<App />)
  await signIn()
  fireEvent.click(
    (await screen.findAllByRole('button', { name: /^Tilbury Distribution Centre/ }))[0],
  )
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  // The first observation in the list.
  fireEvent.click(document.querySelector<HTMLButtonElement>('button.ob-row')!)
  const opened = await screen.findByRole('button', { name: 'Previous observation' })
  expect(opened).toBeInTheDocument()
  const where = window.location.search

  await refresh()

  expect(window.location.search).toBe(where)
  expect(await screen.findByRole('button', { name: 'Previous observation' })).toBeInTheDocument()
})

it('reopens the Site Walk Proposals list after a refresh', async () => {
  // One walk on Tilbury, so the tab offers its proposals; the rest is offline.
  const walk = {
    id: 'w1',
    status: 'recording',
    createdAt: '2026-10-29T08:00:00.000Z',
    recordings: [],
    photos: [],
    notes: [],
    typedText: null,
    proposal: null,
    error: null,
  }
  vi.stubGlobal('fetch', (url: string) =>
    url === '/api/assessments/RPT-2026-0411/site-walks'
      ? Promise.resolve(Response.json([walk]))
      : Promise.reject(new TypeError('Failed to fetch')),
  )
  render(<App />)
  await signIn()
  fireEvent.click(
    (await screen.findAllByRole('button', { name: /^Tilbury Distribution Centre/ }))[0],
  )
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  fireEvent.click(await screen.findByRole('button', { name: /^Site walk proposals/ }))
  expect(await screen.findByRole('heading', { name: 'Site Walk Proposals' })).toBeInTheDocument()

  await refresh()

  expect(await screen.findByRole('heading', { name: 'Site Walk Proposals' })).toBeInTheDocument()
})

it('reopens the proposal review, not a direct save, when its Add observation is refreshed', async () => {
  // A ready walk with an empty proposal; the rest is offline.
  const walk = {
    id: 'w1',
    status: 'ready',
    createdAt: '2026-10-29T08:00:00.000Z',
    recordings: [],
    photos: [],
    notes: [],
    typedText: null,
    proposal: { locations: [], observations: [] },
    error: null,
  }
  vi.stubGlobal('fetch', (url: string) =>
    url === '/api/assessments/RPT-2026-0411/site-walks'
      ? Promise.resolve(Response.json([walk]))
      : url === '/api/assessments/RPT-2026-0411/site-walks/w1'
        ? Promise.resolve(Response.json(walk))
        : Promise.reject(new TypeError('Failed to fetch')),
  )
  window.history.pushState({}, '', '/assessment?ref=RPT-2026-0411&tab=observations&walk=w1')
  render(<App />)
  await signIn()
  act(() =>
    openProposalCapture({
      reference: 'RPT-2026-0411',
      walkId: 'w1',
      locations: [],
      locationId: null,
    }),
  )
  expect(await screen.findByRole('button', { name: 'Add to site walk' })).toBeInTheDocument()
  expect(window.location.pathname).toBe('/site-observation')

  await refresh()

  // Without the walk in the URL, Save here would add straight to the assessment.
  // The review's header: its title is the walk's name alone (round 5), so find its rename.
  expect(await screen.findByRole('button', { name: 'Rename proposal' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save observation' })).not.toBeInTheDocument()
})

it('reopens the Record site walk screen after a refresh', async () => {
  render(<App />)
  await signIn()
  fireEvent.click(
    (await screen.findAllByRole('button', { name: /^Tilbury Distribution Centre/ }))[0],
  )
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Record site walk' }))
  expect(document.querySelector('.sw-recording')).not.toBeNull()

  await refresh()

  await screen.findByRole('tab', { name: /Observations/ })
  expect(document.querySelector('.sw-recording')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Record site walk' })).not.toBeInTheDocument()
})

it('reopens the proposed observation that was open in a review', async () => {
  // A ready walk whose proposal has one observation; the rest is offline.
  const walk = {
    id: 'w1',
    status: 'ready',
    createdAt: '2026-10-29T08:00:00.000Z',
    recordings: [],
    photos: [],
    notes: [],
    typedText: null,
    proposal: {
      locations: [],
      observations: [
        {
          ref: 'obs-1',
          note: 'Coils iced over.',
          copeDimension: 'Occupancy',
          severity: 'moderate',
          locationRef: null,
          recordingSeq: null,
          start: null,
          end: null,
          photoIds: [],
          check: { severity: false, category: false, location: false },
        },
      ],
    },
    error: null,
  }
  vi.stubGlobal('fetch', (url: string) =>
    url === '/api/assessments/RPT-2026-0411/site-walks'
      ? Promise.resolve(Response.json([walk]))
      : url === '/api/assessments/RPT-2026-0411/site-walks/w1'
        ? Promise.resolve(Response.json(walk))
        : url === '/api/assessments/RPT-2026-0411/locations'
          ? Promise.resolve(Response.json([]))
          : Promise.reject(new TypeError('Failed to fetch')),
  )
  window.history.pushState({}, '', '/assessment?ref=RPT-2026-0411&tab=observations&walk=w1')
  render(<App />)
  await signIn()
  fireEvent.click(await screen.findByRole('button', { name: /Coils iced over/ }))
  expect(await screen.findByRole('textbox', { name: 'Note' })).toHaveValue('Coils iced over.')

  await refresh()

  expect(await screen.findByRole('textbox', { name: 'Note' })).toHaveValue('Coils iced over.')
})
