import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { Combobox } from './Combobox'

afterEach(cleanup)

const CLIENTS = ['Northgate Logistics', 'Fennick Foods', 'Harbourline Foods']

// A controlled host, as a form would write it.
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <Combobox
        label="Client"
        hint="Listed client"
        value={value}
        onValueChange={setValue}
        options={CLIENTS}
      />
      <output>{value}</output>
    </>
  )
}
const field = () => screen.getByRole('combobox', { name: 'Client' })
const offered = () =>
  within(screen.getByRole('listbox', { name: 'Suggestions for Client' }))
    .queryAllByRole('option')
    .map((o) => o.textContent)

describe('Combobox', () => {
  it('suggests what contains the typed text, whatever its case, and takes a click', () => {
    render(<Harness />)
    fireEvent.focus(field())
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.change(field(), { target: { value: 'FOODS' } })
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    expect(offered()).toEqual(['Fennick Foods', 'Harbourline Foods'])

    fireEvent.click(screen.getByRole('option', { name: 'Harbourline Foods' }))
    expect(screen.getByRole('status')).toHaveTextContent('Harbourline Foods')
    expect(field()).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves through the suggestions with the arrow keys, takes one with Enter and closes with Escape', () => {
    render(<Harness />)
    fireEvent.focus(field())
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(offered()).toEqual(CLIENTS)
    const first = screen.getByRole('option', { name: 'Northgate Logistics' })
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(field()).toHaveAttribute('aria-activedescendant', first.id)

    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    fireEvent.keyDown(field(), { key: 'ArrowUp' })
    fireEvent.keyDown(field(), { key: 'ArrowUp' })
    // Up from the first wraps to the last.
    expect(screen.getByRole('option', { name: 'Harbourline Foods' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(field()).toHaveValue('Harbourline Foods')

    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    expect(field()).toHaveValue('Harbourline Foods')
  })

  it('keeps text no suggestion has, and lists every suggestion from its chevron', () => {
    render(<Harness initial="Northgate Logistics" />)
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'Severn Paper Group' } })
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    expect(field()).toHaveValue('Severn Paper Group')

    fireEvent.change(field(), { target: { value: 'Northgate Logistics' } })
    expect(offered()).toEqual(['Northgate Logistics'])
    fireEvent.click(screen.getByRole('button', { name: 'Hide suggestions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show suggestions' }))
    expect(offered()).toEqual(CLIENTS)
  })

  it('names the field by its label alone, with its hint as its description', () => {
    render(<Harness />)
    expect(field()).toHaveAccessibleName('Client')
    expect(field()).toHaveAccessibleDescription('Listed client')
  })
})
