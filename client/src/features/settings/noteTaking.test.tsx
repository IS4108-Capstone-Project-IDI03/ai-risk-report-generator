// Tests for Settings > Note-taking (CP-35). Fetch is mocked; no gateway.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlossaryEntry, Settings as SettingsData } from './api'
import { Settings } from './Settings'
import { DEFAULT_CODES } from './noteRules'
import { TIER_IDS } from './tiers'

// A good save is a toast; the real one needs the app's Toaster, so the tests watch the calls.
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: toasts,
}))
// Presses the Undo button of the latest success toast, as a person would.
const pressUndo = () =>
  (toasts.success.mock.lastCall![1] as { action: { onClick: () => void } }).action.onClick()

const base = (canEditGlobal: boolean, glossary: GlossaryEntry[] = []): SettingsData => ({
  canEditGlobal,
  noteTaking: { codes: { fact: 'F', info_request: 'IR', recommendation: 'REC' }, glossary },
  models: [],
  qaStrictness: 'standard',
  sourcePriority: { order: [...TIER_IDS], history: [] },
})
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

// Every PATCH is recorded; the reply is the settings with that change applied (codes: null is
// the defaults), and later reads see it, as the real gateway would.
function mock(start: SettingsData) {
  const patches: unknown[] = []
  let now = start
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patches.push(body)
        const { codes, glossary } = now.noteTaking
        now = {
          ...now,
          noteTaking: {
            codes: 'noteCodes' in body ? (body.noteCodes ?? DEFAULT_CODES) : codes,
            glossary: body.glossary ?? glossary,
          },
        }
      }
      return reply(now)
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
  vi.clearAllMocks()
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
      expect(toasts.success).toHaveBeenCalledWith('Codes saved')
    },
  )

  it('greys out Save with its reason until a code differs from the saved one', async () => {
    const patches = await openIt(base(false))
    // The button is drawn again when its reason box comes or goes, so look it up each time.
    const save = () => screen.getByRole('button', { name: 'Save' })
    expect(save()).toHaveAttribute('aria-disabled', 'true')
    expect(save()).toHaveAccessibleDescription('No changes. Change a code, then save.')
    fireEvent.click(save())
    type('Fact code', 'X')
    expect(save()).not.toHaveAttribute('aria-disabled')
    type('Fact code', 'F')
    expect(save()).toHaveAttribute('aria-disabled', 'true')
    expect(patches).toHaveLength(0)
  })

  it('keeps the shorthand boxes from spell-checking or autofilling', async () => {
    await openIt(base(false))
    for (const label of ['Fact code', 'Term', 'Meaning'])
      expect(screen.getByLabelText(label)).toHaveAttribute('spellcheck', 'false')
    expect(screen.getByLabelText('Term')).toHaveAttribute('autocomplete', 'off')
  })

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
    expect(toasts.success).toHaveBeenCalledWith('Codes reset to defaults', expect.anything())
  })

  it('puts the saved codes back when Undo is pressed on the reset toast', async () => {
    const mine = base(false)
    mine.noteTaking.codes = { fact: 'FACT', info_request: 'ASK', recommendation: 'ADV' }
    const patches = await openIt(mine)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('Fact code')).toHaveValue('F')
    pressUndo()
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1]).toEqual({ noteCodes: mine.noteTaking.codes })
    expect(screen.getByLabelText('Fact code')).toHaveValue('FACT')
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
    expect(toasts.success).toHaveBeenCalledWith('Term added')
    fireEvent.click(screen.getByRole('button', { name: 'Remove fcc' }))
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1]).toEqual({ glossary: [{ term: 'bsmt', meaning: 'basement' }] })
    expect(toasts.success).toHaveBeenCalledWith('Term removed', expect.anything())
  })

  it('brings a removed term back when Undo is pressed on the toast', async () => {
    const list = [
      { term: 'fcc', meaning: 'fire control centre' },
      { term: 'bsmt', meaning: 'basement' },
    ]
    const patches = await openIt(base(false, list))
    fireEvent.click(screen.getByRole('button', { name: 'Remove fcc' }))
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith('Term removed', expect.anything()),
    )
    pressUndo()
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1]).toEqual({ glossary: list })
    expect(await screen.findByRole('button', { name: 'Remove fcc' })).toBeInTheDocument()
  })

  // CP-35: an alert or "Saved" must not outlive the action that made it.
  describe('stale messages', () => {
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
    const gloss = [{ term: 'fcc', meaning: 'fire control centre' }]
    const codeError = () => screen.queryByText('Two types cannot share a code.')
    const termError = () => screen.queryByText('That term is already in your glossary.')
    const dupCode = () => {
      type('Fact code', 'ir')
      click('Save')
    }
    const dupTerm = () => {
      type('Term', 'FCC')
      type('Meaning', 'x')
      click('Add')
    }

    it('clears a code error when the next glossary Add errors or succeeds', async () => {
      await openIt(base(false, gloss))
      dupCode()
      expect(codeError()).toBeInTheDocument()
      dupTerm()
      expect(codeError()).toBeNull()
      expect(termError()).toBeInTheDocument()
      type('Fact code', 'ir')
      click('Save')
      type('Term', 'bsmt')
      type('Meaning', 'basement')
      click('Add')
      expect(codeError()).toBeNull()
      await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Term added'))
    })

    it('clears a term error after Remove and after Reset to defaults', async () => {
      await openIt(base(false, gloss))
      dupTerm()
      expect(termError()).toBeInTheDocument()
      click('Remove fcc')
      expect(termError()).toBeNull()
      await waitFor(() => expect(toasts.success).toHaveBeenCalled())
      dupTerm()
      click('Reset to defaults')
      expect(termError()).toBeNull()
    })

    it('clears a code error when typing in a code box', async () => {
      await openIt(base(false))
      dupCode()
      type('Fact code', 'x')
      expect(codeError()).toBeNull()
    })

    it('shows no success toast for an error, in either area', async () => {
      await openIt(base(false, gloss))
      type('Fact code', 'X')
      click('Save')
      await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
      dupCode()
      expect(codeError()).toBeInTheDocument()
      type('Fact code', 'F')
      click('Save')
      await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(2))
      expect(codeError()).toBeNull()
      dupTerm()
      expect(termError()).toBeInTheDocument()
      expect(toasts.success).toHaveBeenCalledTimes(2)
    })
  })
})
