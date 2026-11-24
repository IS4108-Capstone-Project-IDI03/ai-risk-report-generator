// Tests for a saved recording's length on the observation page (CP-24): read from its audio header
// once it loads, its part of the walk for a walk clip, nothing while it is still transcribing.
// Covers components/RecordingItem.tsx (useAudioSeconds).
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingItem } from './components/RecordingItem'

type Recording = Parameters<typeof RecordingItem>[0]['r']

// A stand-in for the browser's Audio: it says its metadata loaded when told to.
class FakeAudio {
  static made: FakeAudio[] = []
  preload = ''
  duration = 0
  src = ''
  onloadedmetadata: (() => void) | null = null
  constructor() {
    FakeAudio.made.push(this)
  }
  removeAttribute() {}
  load(seconds: number) {
    this.duration = seconds
    this.onloadedmetadata?.()
  }
}

const recording = (fields: Partial<Recording> = {}) =>
  ({
    id: 'r1',
    name: 'Recording 1',
    status: 'transcribed',
    text: 'Valve shut.',
    error: null,
    audioUrl: '/api/observations/o1/recordings/r1/audio',
    clip: null,
    retry: null,
    remove: null,
    canCorrect: false,
    correct: () => {},
    correctedLabel: null,
    addedLabel: null,
    ...fields,
  }) as unknown as Recording

beforeEach(() => {
  FakeAudio.made = []
  vi.stubGlobal('Audio', FakeAudio)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = (r: Recording) =>
  render(
    <ul>
      <RecordingItem r={r} phone={false} />
    </ul>,
  )

describe('Recording length (CP-24)', () => {
  it('shows a saved, transcribed recording’s length once its metadata loads', () => {
    show(recording())
    expect(screen.queryByText('1:05')).toBeNull()
    act(() => FakeAudio.made[0].load(65.2))
    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  it('shows a walk clip’s part of the walk, end minus start, without reading its audio', () => {
    show(recording({ clip: { start: 10, end: 82 } }))
    expect(screen.getByText('1:12')).toBeInTheDocument()
    expect(FakeAudio.made).toHaveLength(0)
  })

  it('reads nothing while the recording is still transcribing', () => {
    show(recording({ status: 'transcribing', text: undefined }))
    expect(FakeAudio.made).toHaveLength(0)
  })
})
