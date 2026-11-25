// The dictate button on an assessment's text fields (CP-27): Stop sends the clip to the gateway,
// and the tidy text goes into the field. The recorder, microphone and gateway are fakes.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DictateButton } from './DictateButton'
import { dictate, fakeMicrophone, fakeMicrophoneEachTest } from './fakeMicrophone'

fakeMicrophoneEachTest()

// A controlled text box with the button beside it, as each field uses it.
function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  const box = useRef<HTMLTextAreaElement>(null)
  return (
    <>
      <textarea
        aria-label="Note"
        ref={box}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <DictateButton reference="RPT-2026-0411" field={() => box.current} onChange={setValue} />
    </>
  )
}

describe('dictating into a field (CP-27)', () => {
  it("puts the gateway's tidy text into the field", async () => {
    render(<Field />)

    await dictate()

    await waitFor(() =>
      expect(screen.getByLabelText('Note')).toHaveValue('The riser is not fire-stopped.'),
    )
    expect(fakeMicrophone.calls[0].url).toBe('/api/assessments/RPT-2026-0411/dictation')
    expect(fakeMicrophone.calls[0].init.method).toBe('POST')
  })
})

describe('when dictating cannot work (CP-27)', () => {
  it('says the microphone is blocked, and how to allow it', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: async () => Promise.reject(new Error('NotAllowedError')) },
    })
    render(<Field />)

    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Microphone blocked')
    expect(alert).toHaveTextContent('Allow it from the lock icon')
  })

  it("shows the gateway's reason and leaves the field as it was", async () => {
    fakeMicrophone.reply = () =>
      Response.json(
        { error: 'No speech was heard. Try again closer to the microphone.' },
        { status: 422 },
      )
    render(<Field initial="Riser" />)

    await dictate()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No speech was heard')
    expect(alert).toHaveTextContent('Try again closer to the microphone.')
    expect(screen.getByLabelText('Note')).toHaveValue('Riser')
  })
})

describe('where dictated words go (CP-27)', () => {
  it('adds them after what is already typed, with a space between', async () => {
    render(<Field initial="Level 3 checked." />)
    const box = screen.getByLabelText<HTMLTextAreaElement>('Note')
    box.setSelectionRange(box.value.length, box.value.length)

    await dictate()

    await waitFor(() => expect(box).toHaveValue('Level 3 checked. The riser is not fire-stopped.'))
  })

  it('puts them in place of the selected words', async () => {
    render(<Field initial="Level 3: [say it]. Level 4 fine." />)
    const box = screen.getByLabelText<HTMLTextAreaElement>('Note')
    box.setSelectionRange(9, 18)

    await dictate()

    await waitFor(() =>
      expect(box).toHaveValue('Level 3: The riser is not fire-stopped. Level 4 fine.'),
    )
  })
})
