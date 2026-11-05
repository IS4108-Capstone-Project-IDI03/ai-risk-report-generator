// Tests for the Site Walk Proposals list (CP-22 rounds 3 and 4): a tab bar of three
// groups (ready, in progress, added) with counts, one compact row per walk with
// its name, detail line, photos and state pill in fixed columns, Retry and Delete
// apart from the row, and the empty state. Covers screens/SiteWalks.tsx, WalkTabs.tsx,
// WalkRow.tsx and DeleteWalkDialog.tsx.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SiteWalks } from '../assessments/screens/SiteWalks'
import type { ProposedObservation, SiteWalk } from './api'

const walk = (f: Partial<SiteWalk> = {}): SiteWalk => ({
  id: 'w1',
  status: 'ready',
  name: null,
  createdAt: '2026-11-02T06:05:00.000Z',
  recordings: [],
  photos: [],
  notes: [],
  typedText: null,
  proposal: null,
  error: null,
  ...f,
})
const loc = (name: string) => ({
  ref: name,
  existingId: null,
  kind: 'building' as const,
  building: 'A',
  floor: null,
  name,
})
// Complete observations by default; `bare` ones lack a severity, so they need fixing.
const obs = (n: number, bare = 0): ProposedObservation[] =>
  Array.from({ length: n }, (_, i) => ({
    ref: `o${i}`,
    note: 'A note',
    copeDimension: 'Protection',
    severity: i < bare ? null : 'high',
    locationRef: 'Roof',
    recordingSeq: null,
    start: null,
    end: null,
    photoIds: [],
    check: { severity: false, category: false, location: false },
  }))
const photos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    url: `/p/${i}.jpg`,
    recordingSeq: null,
    offsetSec: null,
  }))
const recording = (durationSec: number) => ({
  seq: 1,
  durationSec,
  transcription: 'transcribed' as const,
  transcript: null,
  audioUrl: '',
})
function show(
  walks: SiteWalk[],
  fns: {
    onOpen?: () => void
    onRetry?: () => void
    onRecord?: () => void
    onDelete?: (walkId: string) => Promise<void>
  } = {},
) {
  render(
    <SiteWalks
      walks={walks}
      waiting={0}
      onBack={() => {}}
      onOpen={fns.onOpen ?? (() => {})}
      onRetry={fns.onRetry ?? (() => {})}
      onRecord={fns.onRecord ?? (() => {})}
      onDelete={fns.onDelete ?? (() => Promise.resolve())}
    />,
  )
}
// The open group's walk rows.
const rows = () => within(screen.getByRole('region')).queryAllByRole('listitem')
// The tab bar across the top: three buttons, the picked one aria-current.
const tabs = () => within(screen.getByRole('navigation', { name: 'Site walk proposals' }))
beforeAll(() => {
  // jsdom has no <dialog> modal methods; the delete confirmation needs them.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)

describe('the Site Walk Proposals list', () => {
  it('is titled as proposals, with Record site walk in its header', () => {
    const onRecord = vi.fn()
    show([walk()], { onRecord })
    expect(screen.getByRole('heading', { name: 'Site Walk Proposals' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Record site walk' }))
    expect(onRecord).toHaveBeenCalledTimes(1)
  })

  it('lists the walks of one group at a time, with a count per group, newest first', () => {
    show([
      walk({ id: 'rec', status: 'recording', createdAt: '2026-11-02T09:00:00.000Z' }),
      walk({ id: 'old', createdAt: '2026-11-01T06:05:00.000Z' }),
      walk({ id: 'new', createdAt: '2026-11-02T06:05:00.000Z' }),
      walk({ id: 'bad', status: 'failed', createdAt: '2026-11-02T10:00:00.000Z' }),
      walk({ id: 'done', status: 'created', proposal: { locations: [], observations: obs(4) } }),
    ])
    const nav = tabs()
    expect(nav.getByRole('button', { name: /^Ready to review/ })).toHaveTextContent('2')
    expect(nav.getByRole('button', { name: /^In progress/ })).toHaveTextContent('2')
    expect(nav.getByRole('button', { name: /^Added/ })).toHaveTextContent('1')
    // Each tab has a full and a short name (CSS picks one) and its own count.
    expect(nav.getAllByRole('button')).toHaveLength(3)
    expect(nav.getByRole('button', { name: /^Ready to review/ })).toHaveAttribute('aria-current')
    expect(nav.getByRole('button', { name: /^In progress/ })).not.toHaveAttribute('aria-current')
    expect(
      nav.getByRole('button', { name: /^Ready to review/ }).querySelector('.wr-count'),
    ).toHaveTextContent('2')

    // The first group with walks is open; newest first inside it.
    const ready = rows()
    expect(ready).toHaveLength(2)
    expect(ready[0]).toHaveTextContent('2 Nov')
    expect(ready[1]).toHaveTextContent('1 Nov')

    fireEvent.click(nav.getByRole('button', { name: /^In progress/ }))
    expect(nav.getByRole('button', { name: /^In progress/ })).toHaveAttribute('aria-current')
    expect(rows()).toHaveLength(2)
    fireEvent.click(nav.getByRole('button', { name: /^Added/ }))
    expect(rows()[0]).toHaveTextContent('Site walk')
  })

  it('opens the first group that has walks, and says so when a picked group is empty', () => {
    show([walk({ id: 'rec', status: 'recording' })])
    expect(rows()[0]).toHaveTextContent('Recording')
    fireEvent.click(tabs().getByRole('button', { name: /^Ready to review/ }))
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('Nothing to review')).toBeInTheDocument()
  })

  it('names every walk the same way: its given name, else its places, else "Site walk"', () => {
    show([
      walk({ id: 'n', name: 'Warehouse 3 walk', createdAt: '2026-11-03T06:05:00.000Z' }),
      walk({
        id: 'a',
        proposal: {
          locations: [loc('Service corridor'), loc('Loading bay'), loc('Roof'), loc('Lobby')],
          observations: [],
        },
      }),
      walk({ id: 'b', createdAt: '2026-11-01T06:05:00.000Z' }),
    ])
    const [given, places, plain] = rows()
    expect(given).toHaveTextContent(/^Warehouse 3 walk/)
    expect(places).toHaveTextContent(/^Service corridor · Loading bay \+2/)
    expect(plain).toHaveTextContent(/^Site walk/)
    expect(plain).toHaveTextContent(/1 Nov, \d{2}:\d{2}/)
  })

  it('says when it was and what it holds, and how many observations still need fixing', () => {
    show([
      walk({
        id: 'fix',
        createdAt: '2026-11-02T06:05:00.000Z',
        proposal: { locations: [loc('Roof'), loc('Lobby')], observations: obs(3, 2) },
      }),
      walk({
        id: 'ok',
        createdAt: '2026-11-01T06:05:00.000Z',
        proposal: { locations: [loc('Roof')], observations: obs(1) },
      }),
    ])
    const [needsFixing, complete] = rows()
    expect(needsFixing).toHaveTextContent(/2 locations · 3 observations/)
    expect(needsFixing).toHaveTextContent('2 to fix')
    expect(needsFixing).not.toHaveTextContent('Ready to add')
    expect(complete).toHaveTextContent(/1 location · 1 observation/)
    expect(complete).toHaveTextContent('Ready to add')
  })

  it('states a walk that is added, still working or failed in its own words', () => {
    show([
      walk({ id: 'rec', status: 'recording', createdAt: '2026-11-02T09:00:00.000Z' }),
      walk({ id: 'trans', status: 'transcribing', createdAt: '2026-11-02T08:00:00.000Z' }),
      walk({ id: 'prop', status: 'proposing', createdAt: '2026-11-02T07:00:00.000Z' }),
      walk({ id: 'bad', status: 'failed', createdAt: '2026-11-02T06:00:00.000Z' }),
    ])
    const [rec, trans, prop, bad] = rows()
    expect(rec).toHaveTextContent('Recording')
    expect(rec.querySelector('.wr-status-cell')).toHaveTextContent('Recording')
    expect(trans).toHaveTextContent('Transcribing')
    expect(prop).toHaveTextContent('Reading your walk')
    expect(bad).toHaveTextContent('Couldn’t finish')
    fireEvent.click(tabs().getByRole('button', { name: /^Added/ }))
    expect(rows()).toHaveLength(0)
  })

  it('shows "Added" on an added walk, which cannot be opened or deleted', () => {
    show([walk({ status: 'created', proposal: { locations: [], observations: obs(2) } })])
    const row = rows()[0]
    expect(row).toHaveTextContent('Added')
    expect(within(row).queryByRole('button')).toBeNull()
  })

  it('shows up to four photos with "+N", and nothing in their place when there are none', () => {
    show([
      walk({ id: 'a', photos: photos(8) }),
      walk({
        id: 'b',
        createdAt: '2026-11-01T06:05:00.000Z',
        recordings: [{ ...recording(10), transcript: 'Pallets are blocking the fire lane here.' }],
        proposal: { locations: [loc('Retail atrium')], observations: obs(1) },
      }),
    ])
    const [withPhotos, without] = rows()
    expect(withPhotos.querySelectorAll('img')).toHaveLength(4)
    expect(withPhotos).toHaveTextContent('+4')
    expect(within(withPhotos).getByRole('img', { name: '8 photos' })).toBeInTheDocument()
    expect(without.querySelectorAll('img')).toHaveLength(0)
    // The photo column is still there, empty and unlabelled, so the columns line up.
    expect(without.querySelector('.wr-seen')).toBeEmptyDOMElement()
    expect(without.querySelector('.wr-seen')).not.toHaveAttribute('role')
    // The place is the name only; no quote of what was said fills the space.
    expect(without).toHaveTextContent(/^Retail atrium/)
    expect(without).not.toHaveTextContent('Pallets')
  })

  it('opens the walk from the whole row, with one name that includes its state', () => {
    const onOpen = vi.fn()
    show([walk({ name: 'Dock walk', proposal: { locations: [], observations: obs(1) } })], {
      onOpen,
    })
    fireEvent.click(screen.getByRole('button', { name: /^Review Dock walk, .*\. Ready to add$/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('says what failed and retries without opening the row', () => {
    const onOpen = vi.fn()
    const onRetry = vi.fn()
    show([walk({ status: 'failed', error: 'Recording 2 could not be transcribed.' })], {
      onOpen,
      onRetry,
    })
    expect(rows()[0]).toHaveTextContent('Recording 2 could not be transcribed.')
    fireEvent.click(
      within(rows()[0].querySelector<HTMLElement>('.wr-actions')!).getByRole('button', {
        name: 'Retry Site walk',
      }),
    )
    expect(onRetry).toHaveBeenCalledWith('w1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('falls back to a plain sentence when a failed walk stored no reason', () => {
    show([walk({ status: 'failed' })])
    expect(rows()[0]).toHaveTextContent('Couldn’t read the walk')
  })

  it('asks before deleting, then deletes the walk by its id', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    show([walk({ id: 'w9', name: 'Dock walk' })], { onDelete })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Dock walk' }))
    expect(onDelete).not.toHaveBeenCalled()
    const dialog = within(screen.getByRole('dialog', { name: 'Delete this proposal?' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Delete proposal' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('w9'))
  })

  it('says in the confirmation what goes, counting only what the proposal holds', () => {
    show([
      walk({
        name: 'Dock walk',
        recordings: [recording(10), { ...recording(20), seq: 2 }],
        photos: photos(1),
        proposal: { locations: [], observations: obs(5) },
      }),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Delete Dock walk' }))
    expect(screen.getByRole('dialog', { name: 'Delete this proposal?' })).toHaveTextContent(
      '“Dock walk” will be deleted for good, with its 2 recordings, 1 photo and 5 proposed observations. You can’t undo this. Nothing already in the assessment changes.',
    )
  })

  it('leaves out the counts of a walk that holds nothing yet', () => {
    show([walk({ name: 'Dock walk' })])
    fireEvent.click(screen.getByRole('button', { name: 'Delete Dock walk' }))
    expect(screen.getByRole('dialog', { name: 'Delete this proposal?' })).toHaveTextContent(
      '“Dock walk” will be deleted for good. You can’t undo this.',
    )
  })

  // RV-11 AC2: someone else's walks can be read, with nothing to record, retry or delete.
  it("reads someone else's walks with no record, retry or delete", () => {
    const onOpen = vi.fn()
    render(
      <SiteWalks
        walks={[
          walk({ id: 'w1', proposal: { locations: [], observations: obs(1) } }),
          walk({ id: 'w2', status: 'failed', error: 'Could not read it' }),
          walk({ id: 'w3', status: 'recording' }),
        ]}
        waiting={0}
        onBack={() => {}}
        onOpen={onOpen}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Record site walk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Review/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.click(tabs().getByRole('button', { name: /In progress/ }))
    expect(screen.queryByRole('button', { name: /^Retry/ })).not.toBeInTheDocument()
    // A walk still recording opens the recorder, which is the holder's alone.
    expect(screen.queryByRole('button', { name: /^Continue/ })).not.toBeInTheDocument()
  })

  it('has an empty state that offers Record site walk', () => {
    show([])
    const empty = screen.getByText('No site walk proposals yet').parentElement!.parentElement!
    expect(within(empty).getByRole('button', { name: 'Record site walk' })).toBeInTheDocument()
  })
})
