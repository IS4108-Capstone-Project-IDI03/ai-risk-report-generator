// Tests for the tag picker, its badges and the edit page's tags (CP-36 AC1, AC3, AC8, AC9).
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Kind } from './api'
import { KindBadges } from './components/KindBadges'
import { KindPicker } from './components/KindPicker'
import { ObservationKinds } from './components/ObservationKinds'

const suggest = vi.fn()
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  suggestKinds: (...a: unknown[]) => suggest(...a),
}))
afterEach(() => {
  cleanup()
  suggest.mockReset()
})

// Holds the chosen tags the way a screen does.
function Harness({ text = '', blurred = '', start = [] as Kind[], onChange = vi.fn() }) {
  const [value, setValue] = useState<Kind[]>(start)
  return (
    <KindPicker
      value={value}
      reference="R1"
      text={text}
      blurred={blurred}
      onChange={(k) => {
        onChange(k)
        setValue(k)
      }}
    />
  )
}
const chip = (name: string) => screen.getByRole('button', { name })

describe('KindPicker', () => {
  it('toggles any combination, kept in the fixed order', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(chip('Recommendation'))
    fireEvent.click(chip('Fact'))
    expect(onChange).toHaveBeenLastCalledWith(['fact', 'recommendation'])
    expect(chip('Fact')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip('Fact'))
    expect(chip('Fact')).toHaveAttribute('aria-pressed', 'false')
  })

  it('uses real buttons, so Tab reaches them and Enter or Space press them', () => {
    render(<Harness />)
    for (const name of ['Fact', 'Info request', 'Recommendation']) {
      expect(chip(name).tagName).toBe('BUTTON')
      expect(chip(name)).toHaveAttribute('type', 'button')
      expect(chip(name)).not.toHaveAttribute('tabindex', '-1')
    }
  })

  it('shows a suggestion without applying it until Use', async () => {
    suggest.mockResolvedValue(['fact', 'recommendation'])
    const onChange = vi.fn()
    render(<Harness text="Pump is old and should be replaced" onChange={onChange} />)
    fireEvent.click(chip('Suggest'))
    expect(await screen.findByText('Looks like: Fact + Recommendation')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(chip('Fact')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip('Use these'))
    expect(onChange).toHaveBeenCalledWith(['fact', 'recommendation'])
    expect(chip('Recommendation')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/Looks like/)).toBeNull()
  })

  it('drops the suggestion on Ignore and leaves the chips alone', async () => {
    suggest.mockResolvedValue(['info_request'])
    render(<Harness text="Who maintains the sprinkler?" />)
    fireEvent.click(chip('Suggest'))
    await screen.findByText('Looks like: Info request')
    fireEvent.click(chip('Ignore'))
    expect(screen.queryByText(/Looks like/)).toBeNull()
    expect(chip('Info request')).toHaveAttribute('aria-pressed', 'false')
  })

  it('stays silent when the suggestion fails', async () => {
    suggest.mockRejectedValue(new Error('503'))
    render(<Harness text="Pump is old and should be replaced" />)
    fireEvent.click(chip('Suggest'))
    await waitFor(() => expect(suggest).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('suggests once on leaving a long enough note while untouched', async () => {
    suggest.mockResolvedValue(['fact'])
    render(<Harness text="Pump is old" blurred="Pump is old" />)
    expect(await screen.findByText('Looks like: Fact')).toBeInTheDocument()
    expect(suggest).toHaveBeenCalledWith('R1', 'Pump is old')
  })

  it('does not suggest on leaving a short note, or after a tag was chosen', async () => {
    render(<Harness text="Short" blurred="Short" />)
    render(
      <Harness text="Pump is old and rusty" blurred="Pump is old and rusty" start={['fact']} />,
    )
    await Promise.resolve()
    expect(suggest).not.toHaveBeenCalled()
  })

  it('hides Suggest when there is no text to suggest from', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
  })
})

describe('KindBadges', () => {
  it('shows one badge per tag and nothing when untagged', () => {
    const { container, rerender } = render(<KindBadges kinds={['fact', 'recommendation']} />)
    expect(screen.getByText('Fact')).toBeInTheDocument()
    expect(screen.getByText('Recommendation')).toBeInTheDocument()
    rerender(<KindBadges />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ObservationKinds (the edit page)', () => {
  it('saves a choice, and clearing the last tag sends null', async () => {
    const save = vi.fn().mockResolvedValue(true)
    render(<ObservationKinds kinds={['fact']} canChange save={save} text="" />)
    fireEvent.click(chip('Recommendation'))
    expect(save).toHaveBeenLastCalledWith(['fact', 'recommendation'])
    fireEvent.click(chip('Recommendation'))
    fireEvent.click(chip('Fact'))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(null))
  })

  it('puts the chips back when the save is refused', async () => {
    const save = vi.fn().mockResolvedValue(false)
    render(<ObservationKinds kinds={['fact']} canChange save={save} text="" />)
    fireEvent.click(chip('Recommendation'))
    await waitFor(() => expect(chip('Recommendation')).toHaveAttribute('aria-pressed', 'false'))
  })

  it('shows badges and no chips to someone who cannot change it', () => {
    render(<ObservationKinds kinds={['info_request']} canChange={false} save={vi.fn()} text="" />)
    expect(screen.getByText('Info request')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
