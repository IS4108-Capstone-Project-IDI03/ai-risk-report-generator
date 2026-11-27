// Tests for Select, our own dropdown in place of the native one: choosing, type-ahead and disabled
// options. Covers Select.tsx and ChoiceMenu.tsx.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'
import { chooseOption, selectField } from './selectTestHelpers'

const options = [
  { value: 'sg', label: 'Singapore' },
  { value: 'my', label: 'Malaysia' },
  { value: 'mx', label: 'Mexico', disabled: true },
  { value: 'th', label: 'Thailand' },
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Select', () => {
  it('shows the chosen label and hands the value to onChange, as a native select did', () => {
    const onChange = vi.fn()
    render(<Select label="Country" value="sg" options={options} onChange={onChange} />)
    expect(selectField('Country')).toHaveTextContent('Singapore')
    chooseOption('Country', 'Malaysia')
    expect(onChange.mock.calls[0][0].target.value).toBe('my')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows the placeholder while the value is none of the options', () => {
    render(<Select label="Country" value="" placeholder="Choose a country" options={options} />)
    expect(selectField('Country')).toHaveTextContent('Choose a country')
  })

  it('jumps to the option starting with the letters typed, skipping a disabled one', () => {
    render(<Select label="Country" value="sg" options={options} />)
    // Each key a second apart, so each starts a new run of letters.
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000))
    fireEvent.click(selectField('Country'))
    const list = screen.getByRole('listbox', { name: 'Country' })
    fireEvent.keyDown(list, { key: 't' })
    expect(screen.getByRole('option', { name: 'Thailand' })).toHaveFocus()
    fireEvent.keyDown(list, { key: 'm' })
    expect(screen.getByRole('option', { name: 'Malaysia' })).toHaveFocus()
    fireEvent.keyDown(list, { key: 'm' })
    // Mexico is disabled, so a second m cycles back to Malaysia.
    expect(screen.getByRole('option', { name: 'Malaysia' })).toHaveFocus()
    expect(screen.getByRole('option', { name: 'Mexico' })).toBeDisabled()
  })
})
