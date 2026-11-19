// Tests for Settings > Note-taking (CP-35). Fetch is mocked; no gateway.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlossaryEntry, Settings as SettingsData } from './api'
import { Settings } from './Settings'
import { TIER_IDS } from './tiers'

const base = (canEditGlobal: boolean, glossary: GlossaryEntry[] = []): SettingsData => ({
  canEditGlobal,
  noteTaking: { codes: { fact: 'F', info_request: 'IR', recommendation: 'REC' }, glossary },
  models: [],
  qaStrictness: 'standard',
  sourcePriority: { order: [...TIER_IDS], history: [] },
})
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

// Every PATCH is recorded; the reply is the settings with the saved glossary applied.
function mock(start: SettingsData) {
  const patches: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patches.push(body)
        return reply({
          ...start,
          noteTaking: { ...start.noteTaking, glossary: body.glossary ?? start.noteTaking.glossary },
        })
      }
      return reply(start)
    }),
  )
  return patches
}
const openIt = async (s: SettingsData) => {
  const patches = mock(s)
  render(<Settings />)
  fireEvent.click(screen.getByRole('button', { name: 'Note-taking' }))
  await screen.findByLabelText('Fact code')
  return patches
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings > Note-taking (CP-35)', () => {
  it.each([true, false])(
    'shows the defaults and lets each person edit their own (admin %s)',
    async (admin) => {
      const patches = await openIt(base(admin))
      expect(screen.getByLabelText('Fact code')).toHaveValue('F')
      expect(screen.getByLabelText('Info request code')).toHaveValue('IR')
      expect(screen.getByLabelText('Recommendation code')).toHaveValue('REC')
      expect(screen.queryByText(/set by an admin/i)).toBeNull()
      type('Fact code', 'FACT')
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(patches).toHaveLength(1))
      expect(patches[0]).toEqual({
        noteCodes: { fact: 'FACT', info_request: 'IR', recommendation: 'REC' },
      })
    },
  )

  it('blocks an empty or long code, and a shared code, before sending', async () => {
    const patches = await openIt(base(false))
    type('Fact code', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Each code needs 1 to 8 letters or digits.')).toBeInTheDocument()
    type('Fact code', 'a-b')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Each code needs 1 to 8 letters or digits.')).toBeInTheDocument()
    type('Fact code', 'ir')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Two types cannot share a code.')).toBeInTheDocument()
    expect(patches).toHaveLength(0)
  })

  it('resets to the defaults by sending null', async () => {
    const patches = await openIt(base(false))
    type('Fact code', 'X')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await waitFor(() => expect(patches).toEqual([{ noteCodes: null }]))
    expect(screen.getByLabelText('Fact code')).toHaveValue('F')
  })

  it('adds and removes glossary terms, checking them first', async () => {
    const patches = await openIt(base(false, [{ term: 'fcc', meaning: 'fire control centre' }]))
    expect(screen.getByText('fire control centre', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('The term needs 1 to 30 characters.')).toBeInTheDocument()
    type('Term', 'FCC')
    type('Meaning', 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('That term is already in your glossary.')).toBeInTheDocument()
    type('Term', 'bsmt')
    type('Meaning', 'basement')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({
      glossary: [
        { term: 'fcc', meaning: 'fire control centre' },
        { term: 'bsmt', meaning: 'basement' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove fcc' }))
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1]).toEqual({ glossary: [{ term: 'bsmt', meaning: 'basement' }] })
  })
})
