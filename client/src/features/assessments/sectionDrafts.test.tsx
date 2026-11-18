// What survived Generation's per-section table (GN-13 moved drafting to the background): how a
// draft's out-of-date changes are described (CP-08, used by Review's DraftEditor) and the
// observation excerpt in a draft's evidence (used by Review's OFI sources).
import { ObservationExcerpt } from './components/ObservationExcerpt'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it } from 'vitest'
import type { SavedObservation } from './api'
import { describeChanges } from './reviewDisplay'

const RISER: SavedObservation = {
  id: 'o1',
  engineer: 'Alex Rowe',
  copeDimensions: ['Construction'],
  standard: null,
  severity: 'high',
  location: { id: 'l1', building: null, name: 'Riser B', floor: 'Level 3' },
  note: 'Riser shaft not fire-stopped at L3.',
  recordings: [
    {
      id: 'r1',
      name: 'Recording 1',
      contentType: 'audio/x-m4a',
      size: 1000,
      url: '/api/observations/o1/recordings/r1/audio',
      transcription: {
        status: 'transcribed',
        transcript: 'the gap is around the cable tray',
        correction: null,
        error: null,
        attempts: 1,
      },
      added: null,
    },
  ],
  photos: [],
  removedRecordings: [],
  removedPhotos: [],
  interpretation: null,
  recordedAt: '2026-09-23T09:10:00.000Z',
  edited: null,
  deleted: null,
}
afterEach(() => {
  cleanup()
})

it('describes each kind of change and never mentions a kind with none (CP-08)', () => {
  const cases = [
    [{ added: 1, changed: 0, removed: 0 }, '1 observation added'],
    [{ added: 0, changed: 2, removed: 0 }, '2 observations changed'],
    [{ added: 0, changed: 0, removed: 1 }, '1 observation removed'],
    [{ added: 0, changed: 1, removed: 3 }, '1 observation changed and 3 removed'],
    [{ added: 2, changed: 1, removed: 1 }, '2 observations added, 1 changed and 1 removed'],
    [{ added: 0, changed: 0, removed: 0 }, ''],
  ] as const
  for (const [counts, text] of cases) expect(describeChanges(counts)).toBe(text)
})

it('shows the corrected transcript in draft evidence and keeps the original behind a toggle', () => {
  render(
    <ObservationExcerpt
      observation={{
        ...RISER,
        recordings: [
          {
            ...RISER.recordings[0],
            transcription: {
              ...RISER.recordings[0].transcription,
              transcript: 'I found a leaf unable to use.',
              correction: {
                text: 'I found a lift unable to use.',
                at: '2026-10-10T05:59:27Z',
                by: { id: 'e1', name: 'Alex' },
              },
            },
          },
        ],
      }}
    />,
  )
  expect(screen.getByText('I found a lift unable to use.')).toBeInTheDocument()
  expect(screen.getByText('Corrected voice transcript · Recording 1')).toBeInTheDocument()
  expect(screen.queryByText('I found a leaf unable to use.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show original transcript' }))
  expect(screen.getByText('I found a leaf unable to use.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Hide original transcript' }))
  expect(screen.queryByText('I found a leaf unable to use.')).not.toBeInTheDocument()
})
