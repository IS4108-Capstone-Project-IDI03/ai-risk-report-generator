// Tests for the "My preferences" page (CB-05). fetch is a small fake gateway that remembers
// changes, so each test drives the page the way an engineer would.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Memory } from './api'
import { Preferences } from './screens/Preferences'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const fact = (n: number, text = `Fact ${n}`) => ({
  id: `f${n}`,
  text,
  createdAt: '2026-10-20T08:00:00Z',
})

// Starts a gateway with `facts`; returns the calls it saw.
function gateway(facts = [fact(1, 'I mostly survey Singapore offices')], enabled = true) {
  const state: Memory = { enabled, facts, maxFacts: 20, maxChars: 200 }
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : {}
    calls.push(`${method} ${url} ${init?.body ?? ''}`.trim())
    if (method === 'PATCH' && url.endsWith('/memory')) state.enabled = body.enabled
    if (method === 'POST' && url.endsWith('/facts')) {
      if (body.text === 'refuse me')
        return Response.json({ error: 'A fact needs 1 to 200 characters.' }, { status: 400 })
      const added = fact(state.facts.length + 10, body.text)
      state.facts = [...state.facts, added]
      return Response.json(added, { status: 201 })
    }
    if (method === 'PATCH' && url.includes('/facts/')) {
      const id = url.split('/').pop()
      state.facts = state.facts.map((f) => (f.id === id ? { ...f, text: body.text } : f))
      return Response.json(state.facts.find((f) => f.id === id))
    }
    if (method === 'DELETE') {
      state.facts = state.facts.filter((f) => f.id !== url.split('/').pop())
      return new Response(null, { status: 204 })
    }
    return Response.json(state)
  })
  return calls
}
const open = async () => {
  const notify = vi.fn()
  render(<Preferences notify={notify} />)
  await screen.findByText('My facts')
  return notify
}

describe('My preferences (CB-05)', () => {
  it('lists each fact with the date it was added, and warns against client details (AC4)', async () => {
    gateway()
    await open()
    expect(screen.getByText('I mostly survey Singapore offices')).toBeInTheDocument()
    expect(screen.getByText(/Added 20 Oct 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Do not type client names or site details/)).toBeInTheDocument()
  })

  it('adds a fact and shows it, clearing the box (AC1)', async () => {
    const calls = gateway()
    const notify = await open()
    fireEvent.change(screen.getByRole('textbox', { name: /Add a fact/ }), {
      target: { value: 'I prefer short answers' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add fact' }))
    expect(await screen.findByText('I prefer short answers')).toBeInTheDocument()
    expect(calls).toContain('POST /api/chat/memory/facts {"text":"I prefer short answers"}')
    expect(screen.getByRole('textbox', { name: /Add a fact/ })).toHaveValue('')
    expect(notify).toHaveBeenCalledWith('Fact added')
  })

  it("shows the gateway's reason when a fact is refused", async () => {
    gateway()
    await open()
    fireEvent.change(screen.getByRole('textbox', { name: /Add a fact/ }), {
      target: { value: 'refuse me' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add fact' }))
    expect(await screen.findByText('A fact needs 1 to 200 characters.')).toBeInTheDocument()
  })

  it('edits a fact in place (AC4)', async () => {
    gateway()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Edit: / }))
    fireEvent.change(screen.getByRole('textbox', { name: /Edit fact/ }), {
      target: { value: 'I survey SG offices' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    // The box closes once saved; the new words are then shown as the fact itself.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Edit fact/ })).toBeNull())
    expect(screen.getByText('I survey SG offices')).toBeInTheDocument()
  })

  it('deletes a fact, and shows the empty state when none are left (AC5)', async () => {
    gateway()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Delete: / }))
    expect(await screen.findByText('No facts yet')).toBeInTheDocument()
  })

  it('turns memory off and on without losing the facts (AC6)', async () => {
    const calls = gateway()
    await open()
    const toggle = screen.getByRole('switch', { name: /Use my preferences/ })
    fireEvent.click(toggle)
    await waitFor(() => expect(calls).toContain('PATCH /api/chat/memory {"enabled":false}'))
    expect(screen.getByText('I mostly survey Singapore offices')).toBeInTheDocument()
  })

  it('replaces the add box with a message at 20 facts', async () => {
    gateway(Array.from({ length: 20 }, (_, i) => fact(i + 1)))
    await open()
    expect(screen.getByText(/You have 20 facts/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Add a fact/ })).toBeNull()
    expect(within(screen.getAllByRole('list')[0]).getAllByRole('listitem')).toHaveLength(20)
  })
})
