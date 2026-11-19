import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ChipInput } from './ChipInput'

afterEach(cleanup)

// The headings in use, as a tree: what each level offers under the bubbles before it.
const TREE: Record<string, string[]> = {
  '': ['Chapter 8 Installation', 'Chapter 9 Hangers'],
  'Chapter 8 Installation': ['8.6 Hangers', '8.15 Special situations'],
  'Chapter 9 Hangers': ['9.1 General'],
}
const suggest = vi.fn((_level: number, before: string[]) => TREE[before.join(' > ')] ?? [])

// A controlled host inside a form, as the clause editor writes it.
function Harness({ initial = [] as string[], onSubmit = vi.fn() }) {
  const [value, setValue] = useState(initial)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <ChipInput
        label="Heading trail"
        itemName="heading"
        value={value}
        onChange={setValue}
        suggest={suggest}
      />
      <output>{JSON.stringify(value)}</output>
    </form>
  )
}
const box = () => screen.getByRole('combobox', { name: 'Heading trail' })
const bubbles = () =>
  within(screen.getByRole('list', { name: 'Added to Heading trail' }))
    .queryAllByRole('listitem')
    .map((b) => b.textContent)
const saved = () => JSON.parse(screen.getByRole('status').textContent ?? '[]')
const offered = () =>
  within(screen.getByRole('listbox', { name: 'Suggestions for Heading trail' }))
    .queryAllByRole('option')
    .map((o) => o.textContent)
const typeIn = (text: string) => {
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: text } })
}
const press = (key: string) => fireEvent.keyDown(box(), { key })

describe('ChipInput', () => {
  it('turns typed text, spaces and all, into a bubble on Enter, without submitting the form', () => {
    const submitted = vi.fn()
    render(<Harness onSubmit={submitted} />)

    typeIn('Chapter 8 Installation')
    press('Enter')

    expect(saved()).toEqual(['Chapter 8 Installation'])
    expect(bubbles()).toEqual([expect.stringContaining('Chapter 8 Installation')])
    expect(box()).toHaveValue('')
    expect(submitted).not.toHaveBeenCalled()
  })

  it('makes no bubble of blank text', () => {
    render(<Harness />)

    typeIn('   ')
    press('Enter')

    expect(saved()).toEqual([])
  })

  it('suggests the headings used at the level being typed, under the bubbles before it', () => {
    render(<Harness initial={['Chapter 8 Installation']} />)

    fireEvent.focus(box())
    fireEvent.click(box())

    expect(offered()).toEqual(['8.6 Hangers', '8.15 Special situations'])
    expect(suggest).toHaveBeenLastCalledWith(1, ['Chapter 8 Installation'])
  })

  it('narrows the suggestions as you type, and the arrow keys and Enter pick one', () => {
    render(<Harness initial={['Chapter 8 Installation']} />)

    typeIn('special')
    expect(offered()).toEqual(['8.15 Special situations'])
    press('ArrowDown')
    press('Enter')

    expect(saved()).toEqual(['Chapter 8 Installation', '8.15 Special situations'])
  })

  it('keeps exactly what was typed when Enter is pressed with nothing highlighted', () => {
    render(<Harness initial={['Chapter 8 Installation']} />)

    typeIn('8.6')
    press('Enter')

    expect(saved()).toEqual(['Chapter 8 Installation', '8.6'])
  })

  it('removes a bubble with its button, and the last one with Backspace in an empty box', () => {
    render(<Harness initial={['Chapter 8 Installation', '8.6 Hangers', '8.6.1 Spacing']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove heading 8.6 Hangers' }))
    expect(saved()).toEqual(['Chapter 8 Installation', '8.6.1 Spacing'])

    fireEvent.focus(box())
    press('Backspace')
    expect(saved()).toEqual(['Chapter 8 Installation'])
  })

  it('splits pasted text on > and new lines into bubbles', () => {
    render(<Harness />)
    fireEvent.focus(box())

    fireEvent.paste(box(), {
      clipboardData: { getData: () => 'Chapter 8 Installation > 8.6 Hangers\n8.6.1 Spacing' },
    })

    expect(saved()).toEqual(['Chapter 8 Installation', '8.6 Hangers', '8.6.1 Spacing'])
  })

  it('edits a bubble in place with its own level’s suggestions; Escape cancels', () => {
    render(<Harness initial={['Chapter 8 Installation', '8.6 Hangers']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit heading 8.6 Hangers' }))
    expect(box()).toHaveValue('8.6 Hangers')
    fireEvent.click(box())
    // Its own value isn't offered back to it.
    expect(offered()).toEqual(['8.15 Special situations'])

    fireEvent.change(box(), { target: { value: '8.6 Hangers and supports' } })
    press('Escape')
    press('Escape')
    expect(saved()).toEqual(['Chapter 8 Installation', '8.6 Hangers'])

    fireEvent.click(screen.getByRole('button', { name: 'Edit heading 8.6 Hangers' }))
    fireEvent.change(box(), { target: { value: '8.6 Hangers and supports' } })
    press('Enter')
    expect(saved()).toEqual(['Chapter 8 Installation', '8.6 Hangers and supports'])
  })

  it('keeps text left in the box as a bubble when the field is left', () => {
    render(<Harness initial={['Chapter 8 Installation']} />)

    typeIn('8.6 Hangers')
    fireEvent.blur(box())

    expect(saved()).toEqual(['Chapter 8 Installation', '8.6 Hangers'])
  })

  it('names the whole control by its label, and lists its bubbles', () => {
    render(<Harness initial={['Chapter 8 Installation']} />)

    expect(screen.getByLabelText('Heading trail')).toBe(box())
    expect(bubbles()).toHaveLength(1)
  })
})
