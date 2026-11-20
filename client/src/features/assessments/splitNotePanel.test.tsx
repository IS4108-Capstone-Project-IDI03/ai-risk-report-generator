// Tests for the Split note panel (CP-35). Fetch is mocked; no gateway, no paid call.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Part } from './api'
import { SplitNotePanel } from './components/SplitNotePanel'

const part = (id: string, kind: Part['kind'], text: string, o: Partial<Part> = {}): Part => ({
  id,
  kind,
  text,
  shorthand: text.toLowerCase(),
  inferred: false,
  flags: [],
  ...o,
})
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

const THREE = [
  part('a', 'fact', 'Valve V-12 chained open.', { shorthand: 'F: v12 chained', inferred: true }),
  part('b', 'info_request', 'Send the hydrant test report.'),
  part('c', 'recommendation', 'Fit a tamper switch.'),
]
let splitReply: () => Promise<Response>
let gloss: unknown[]
const calls: { url: string; body?: unknown }[] = []
vi.stubGlobal('fetch', undefined)
function mock() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/split-note')) return splitReply()
      if (init?.method === 'PATCH') {
        gloss = JSON.parse(String(init.body)).glossary
        return reply(200, {})
      }
      return reply(200, {
        noteTaking: { codes: {}, glossary: [{ term: 'old', meaning: 'older' }] },
      })
    }),
  )
}
// Holds the confirmed parts the way the workflow does.
let confirmed: Part[] | null = null
function Harness({ note = 'a note', saving = false }: { note?: string; saving?: boolean }) {
  const [parts, setParts] = useState<Part[] | null>(null)
  return (
    <SplitNotePanel
      reference="R1"
      note={note}
      saving={saving}
      parts={parts}
      setParts={(p) => {
        confirmed = p
        setParts(p)
      }}
    />
  )
}
const group = (name: string) => screen.getByRole('group', { name })
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
async function open(parts = THREE, props = {}) {
  splitReply = () => reply(200, { parts })
  render(<Harness {...props} />)
  click('Split note')
  await screen.findByRole('button', { name: 'Confirm all parts' })
}
afterEach(() => {
  cleanup()
  calls.length = 0
  confirmed = null
  vi.unstubAllGlobals()
})

describe('Split note panel (CP-35)', () => {
  it('shows three groups with counts, and Inferred only on a guessed part', async () => {
    mock()
    await open()
    for (const [name, n] of [
      ['Facts', '1'],
      ['Info requests', '1'],
      ['Recommendations', '1'],
    ])
      expect(within(group(name)).getByRole('heading')).toHaveTextContent(n)
    expect(screen.getAllByText('Inferred')).toHaveLength(1)
    expect(screen.getByText('You wrote: F: v12 chained')).toBeInTheDocument()
    expect(calls[0]).toEqual({ url: '/api/assessments/R1/split-note', body: { note: 'a note' } })
  })

  it('edits text, moves a part, shows None for an empty group', async () => {
    mock()
    await open()
    const box = within(group('Facts')).getByLabelText('Part text')
    fireEvent.change(box, { target: { value: 'Valve open.' } })
    expect(box).toHaveValue('Valve open.')
    fireEvent.change(within(group('Facts')).getByLabelText('Move to'), {
      target: { value: 'recommendation' },
    })
    expect(within(group('Facts')).getByText('None')).toBeInTheDocument()
    expect(within(group('Recommendations')).getAllByLabelText('Part text')).toHaveLength(2)
  })

  it('splits at the first "; " or ". ", and merges with the next', async () => {
    mock()
    await open([part('a', 'fact', 'Valve open; tag missing'), part('b', 'fact', 'Pump off.')])
    expect(within(group('Facts')).getAllByRole('button', { name: 'Split' })[1]).toBeDisabled()
    fireEvent.click(within(group('Facts')).getAllByRole('button', { name: 'Split' })[0])
    const texts = () =>
      within(group('Facts'))
        .getAllByLabelText('Part text')
        .map((t) => (t as HTMLTextAreaElement).value)
    expect(texts()).toEqual(['Valve open', 'tag missing', 'Pump off.'])
    fireEvent.click(within(group('Facts')).getAllByRole('button', { name: 'Merge with next' })[0])
    expect(texts()).toEqual(['Valve open tag missing', 'Pump off.'])
    // The last part of a group has no next one.
    expect(within(group('Facts')).getAllByRole('button', { name: 'Merge with next' })).toHaveLength(
      1,
    )
  })

  it('deletes and adds parts', async () => {
    mock()
    await open()
    fireEvent.click(within(group('Facts')).getByRole('button', { name: 'Delete' }))
    expect(within(group('Facts')).getByText('None')).toBeInTheDocument()
    fireEvent.click(within(group('Facts')).getByRole('button', { name: '+ Add part' }))
    expect(within(group('Facts')).getByLabelText('Part text')).toHaveValue('')
  })

  it('blocks Confirm on an unknown term until it is added to the glossary', async () => {
    mock()
    await open([
      part('a', 'fact', 'Check bsmt fcc.', {
        flags: [{ type: 'unknown_term', detail: 'bsmt fcc' }],
      }),
    ])
    expect(screen.getByRole('button', { name: 'Confirm all parts' })).toBeDisabled()
    expect(screen.getByText(/Unknown shorthand: "bsmt fcc"/)).toBeInTheDocument()
    click('Add to my glossary')
    fireEvent.change(screen.getByLabelText(/What "bsmt fcc" means/), {
      target: { value: 'basement fire control centre' },
    })
    click('Save term')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm all parts' })).toBeEnabled(),
    )
    // The new term joins the ones already saved.
    expect(gloss).toEqual([
      { term: 'old', meaning: 'older' },
      { term: 'bsmt fcc', meaning: 'basement fire control centre' },
    ])
  })

  it('clears a number warning with Looks right, which never blocks Confirm', async () => {
    mock()
    await open([
      part('a', 'fact', 'Pipe 50 mm.', {
        flags: [{ type: 'number_changed', detail: '5 mm to 50 mm' }],
      }),
    ])
    expect(screen.getByRole('button', { name: 'Confirm all parts' })).toBeEnabled()
    click('Looks right')
    expect(screen.queryByText(/may have changed/)).toBeNull()
  })

  it('confirms to a summary, and Edit parts reopens', async () => {
    mock()
    await open()
    click('Confirm all parts')
    expect(
      screen.getByText('3 parts confirmed (1 fact, 1 request, 1 recommendation)'),
    ).toBeInTheDocument()
    expect(confirmed).toHaveLength(3)
    click('Edit parts')
    expect(screen.getByRole('button', { name: 'Confirm all parts' })).toBeInTheDocument()
  })

  it('Cancel leaves nothing confirmed', async () => {
    mock()
    await open()
    click('Cancel')
    expect(confirmed).toBeNull()
    expect(screen.queryByRole('group', { name: 'Facts' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Split note' })).toBeEnabled()
  })

  it('enables Split note only with text and nothing saving', () => {
    mock()
    const { rerender } = render(<Harness note="  " />)
    expect(screen.getByRole('button', { name: 'Split note' })).toBeDisabled()
    rerender(<Harness note="text" saving />)
    expect(screen.getByRole('button', { name: 'Split note' })).toBeDisabled()
  })

  it('drops confirmed parts when the note changes', async () => {
    mock()
    splitReply = () => reply(200, { parts: THREE })
    const { rerender } = render(<Harness note="one" />)
    click('Split note')
    await screen.findByRole('button', { name: 'Confirm all parts' })
    click('Confirm all parts')
    rerender(<Harness note="one two" />)
    expect(await screen.findByText('The note changed, so split it again.')).toBeInTheDocument()
    expect(confirmed).toBeNull()
  })

  it.each([
    [400, 'The note is too long.'],
    [503, 'Masking is unavailable.'],
    [502, 'The note could not be sorted just now.'],
  ])('shows a %s as a problem and a fix, leaving the note alone', async (status, message) => {
    mock()
    splitReply = () => reply(status, { error: message })
    render(<Harness />)
    click('Split note')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(alert).toHaveTextContent('Your note is unchanged.')
    expect(confirmed).toBeNull()
  })
})
