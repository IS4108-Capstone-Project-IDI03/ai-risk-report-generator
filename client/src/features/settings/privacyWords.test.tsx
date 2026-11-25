// Settings > Privacy words (PV-09): the knowledge admin's Always masked and Never masked lists,
// and the words past reports had masked. Fetch is mocked; no gateway is called.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrivacyWords, Settings as SettingsData } from './api'
import { Toaster } from '../../design-system'
import { Settings } from './Settings'
import { TIER_IDS } from './tiers'

const settings = (canEditGlobal: boolean): SettingsData => ({
  canEditGlobal,
  models: [],
  qaStrictness: 'standard',
  sourcePriority: { order: [...TIER_IDS], history: [] },
})
const word = (o: Partial<PrivacyWords['never'][number]>): PrivacyWords['never'][number] => ({
  id: 'w1',
  list: 'never',
  word: 'Sprinkl',
  kind: null,
  reason: 'report wording',
  source: 'default',
  addedBy: null,
  at: '2026-11-22T03:00:00.000Z',
  ...o,
})
const lists = (o: Partial<PrivacyWords> = {}): PrivacyWords => ({
  protectionOn: true,
  always: [],
  never: [word({})],
  history: [],
  ...o,
})
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

// The gateway: Settings, the lists, and whatever `extra` answers first.
function mock(
  canEdit: boolean,
  start: PrivacyWords = lists(),
  extra: (url: string, init?: RequestInit) => Promise<Response> | null = () => null,
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const handled = extra(url, init)
    if (handled) return handled
    if (url === '/api/settings/privacy-words/masked-in-reports') return reply(200, { words: [] })
    if (url === '/api/settings/privacy-words') return reply(200, start)
    if (url === '/api/chat/memory')
      return reply(200, { enabled: true, facts: [], maxFacts: 5, maxChars: 200 })
    return reply(200, settings(canEdit))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
async function openPrivacyWords() {
  fireEvent.click(await screen.findByRole('button', { name: 'Privacy Words' }))
  return screen.findByRole('region', { name: 'Privacy Words' })
}
beforeAll(() => {
  // jsdom has no native modal dialog.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Privacy words (PV-09)', () => {
  it('is in the menu for a knowledge admin, and not for an engineer (AC6)', async () => {
    mock(true)
    render(<Settings />)
    const panel = await openPrivacyWords()
    expect(await within(panel).findByText('Sprinkl')).toBeInTheDocument()
    cleanup()

    const fetchMock = mock(false)
    render(<Settings />)
    await screen.findByRole('button', { name: 'Models' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Privacy Words' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/settings/privacy-words')
  })

  it('adds a word with its reason when I press Enter (AC3)', async () => {
    let current = lists()
    const fetchMock = mock(true, current, (url, init) => {
      if (url === '/api/settings/privacy-words' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        current = lists({ never: [...current.never, word({ id: 'w2', ...body, source: 'admin' })] })
        return reply(201, {})
      }
      if (url === '/api/settings/privacy-words') return reply(200, current)
      return null
    })
    render(<Settings />)
    const panel = await openPrivacyWords()

    fireEvent.change(within(panel).getByLabelText(/^Word/), { target: { value: 'Hosereel' } })
    fireEvent.change(within(panel).getByLabelText(/^Reason/), { target: { value: 'equipment' } })
    fireEvent.submit(within(panel).getByLabelText(/^Word/).closest('form')!)

    expect(await within(panel).findByText('Hosereel')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      list: 'never',
      word: 'Hosereel',
      reason: 'equipment',
    })
    expect(within(panel).getByLabelText(/^Word/)).toHaveValue('')
  })

  it('asks for a reason before sending anything', async () => {
    const fetchMock = mock(true)
    render(<Settings />)
    const panel = await openPrivacyWords()

    fireEvent.change(within(panel).getByLabelText(/^Word/), { target: { value: 'Hosereel' } })
    fireEvent.submit(within(panel).getByLabelText(/^Word/).closest('form')!)

    expect(await within(panel).findByText(/Say why/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it("shows the gateway's reason when a word is refused, e.g. a recorded client (AC4)", async () => {
    mock(true, lists(), (_url, init) =>
      init?.method === 'POST'
        ? reply(409, { error: '"Jurong Port" is a recorded client name, so it is always masked.' })
        : null,
    )
    render(<Settings />)
    const panel = await openPrivacyWords()

    fireEvent.change(within(panel).getByLabelText(/^Word/), { target: { value: 'jurong port' } })
    fireEvent.change(within(panel).getByLabelText(/^Reason/), { target: { value: 'test' } })
    fireEvent.submit(within(panel).getByLabelText(/^Word/).closest('form')!)

    expect(await within(panel).findByText(/recorded client name/)).toBeInTheDocument()
    expect(within(panel).getByLabelText(/^Word/)).toHaveValue('jurong port')
  })

  it('removes a Never masked word at once, and Undo puts it back with its reason', async () => {
    let current = lists()
    const fetchMock = mock(true, current, (url, init) => {
      if (init?.method === 'DELETE') {
        current = lists({ never: [] })
        return reply(200, {})
      }
      if (init?.method === 'POST') {
        current = lists()
        return reply(201, {})
      }
      if (url === '/api/settings/privacy-words') return reply(200, current)
      return null
    })
    render(
      <>
        <Settings />
        <Toaster />
      </>,
    )
    const panel = await openPrivacyWords()

    fireEvent.click(await within(panel).findByRole('button', { name: 'Remove Sprinkl' }))
    await waitFor(() => expect(within(panel).queryByText('Sprinkl')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/privacy-words/w1',
      expect.objectContaining({ method: 'DELETE' }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await within(panel).findByText('Sprinkl')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      list: 'never',
      word: 'Sprinkl',
      reason: 'report wording',
    })
  })

  it('adds an Always masked name with its kind, and asks before removing one (AC1)', async () => {
    let current = lists()
    const crest = word({ id: 'a1', list: 'always', word: 'Crest Tower', kind: 'SITE' })
    const fetchMock = mock(true, current, (url, init) => {
      if (init?.method === 'POST') {
        current = lists({ always: [crest] })
        return reply(201, {})
      }
      if (init?.method === 'DELETE') {
        current = lists()
        return reply(200, {})
      }
      if (url === '/api/settings/privacy-words') return reply(200, current)
      return null
    })
    render(<Settings />)
    const panel = await openPrivacyWords()
    fireEvent.click(within(panel).getByRole('radio', { name: /Always masked/ }))

    fireEvent.change(within(panel).getByLabelText(/^Name/), { target: { value: 'Crest Tower' } })
    fireEvent.change(within(panel).getByLabelText(/^Masked as/), { target: { value: 'SITE' } })
    fireEvent.change(within(panel).getByLabelText(/^Reason/), { target: { value: 'old report' } })
    fireEvent.submit(within(panel).getByLabelText(/^Name/).closest('form')!)

    expect(await within(panel).findByText('Crest Tower')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      list: 'always',
      word: 'Crest Tower',
      kind: 'SITE',
      reason: 'old report',
    })

    fireEvent.click(within(panel).getByRole('button', { name: 'Remove Crest Tower' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Crest Tower will reach AI providers as written')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(within(panel).queryByText('Crest Tower')).not.toBeInTheDocument())
  })

  it('lists the words past reports had masked, likely mistakes first, and moves one to Never masked (AC10)', async () => {
    mock(true, lists(), (url) =>
      url === '/api/settings/privacy-words/masked-in-reports'
        ? reply(200, {
            words: [
              { word: 'Mei Lin', kind: 'PERSON', reports: 3, neverMasked: false },
              { word: 'Sprinkl', kind: 'PERSON', reports: 2, neverMasked: true },
              { word: 'L31', kind: 'PERSON', reports: 1, neverMasked: false },
              { word: '+65 9123 4567', kind: 'PHONE', reports: 4, neverMasked: false },
            ],
          })
        : null,
    )
    render(<Settings />)
    const panel = await openPrivacyWords()
    fireEvent.click(within(panel).getByRole('radio', { name: /Masked in reports/ }))

    const rows = await within(panel).findAllByRole('row')
    // A name that looks like a code or a fragment first; then by how many reports hold it;
    // words already on Never masked last.
    expect(rows.slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
      'L31',
      '+65 9123 4567',
      'Mei Lin',
      'Sprinkl',
    ])
    expect(within(rows[4]).getByText('Never masked')).toBeInTheDocument()

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Never mask L31' }))
    expect(within(panel).getByRole('radio', { name: /Never masked/ })).toBeChecked()
    expect(within(panel).getByLabelText(/^Word/)).toHaveValue('L31')
    expect(within(panel).getByLabelText(/^Reason/)).toHaveFocus()
  })

  it('labels the words that come with the app Default', async () => {
    mock(
      true,
      lists({
        never: [
          word({}),
          word({ id: 'w2', word: 'Hosereel', source: 'admin', addedBy: { id: 'u2', name: 'Lee' } }),
        ],
      }),
    )
    render(<Settings />)
    const panel = await openPrivacyWords()
    const row = (await within(panel).findByText('Sprinkl')).closest('tr')!

    expect(within(row).getByText('Default')).toBeInTheDocument()
    expect(within(panel).getByRole('option', { name: 'Default' })).toHaveValue('default')
    expect(within(panel).queryByText('Shipped with the app')).not.toBeInTheDocument()
  })

  it('filters the words to the defaults or one admin’s', async () => {
    mock(
      true,
      lists({
        never: [
          word({}),
          word({
            id: 'w2',
            word: 'Hosereel',
            source: 'admin',
            addedBy: { id: 'u2', name: 'Lee' },
          }),
          word({ id: 'w3', word: 'L31', source: 'admin', addedBy: { id: 'u1', name: 'Sana' } }),
        ],
      }),
    )
    render(<Settings />)
    const panel = await openPrivacyWords()
    await within(panel).findByText('Hosereel')
    const words = () =>
      within(panel)
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0].textContent)

    fireEvent.change(within(panel).getByLabelText(/^Added by/), { target: { value: 'default' } })
    expect(words()).toEqual(['Sprinkl'])
    fireEvent.change(within(panel).getByLabelText(/^Added by/), { target: { value: 'u2' } })
    expect(words()).toEqual(['Hosereel'])
    fireEvent.change(within(panel).getByLabelText(/^Added by/), { target: { value: '' } })
    expect(words()).toEqual(['Sprinkl', 'Hosereel', 'L31'])
  })

  it('says nothing matches when the filter and the search together find no word', async () => {
    mock(
      true,
      lists({
        never: [
          ...Array.from({ length: 8 }, (_, i) => word({ id: `d${i}`, word: `Default${i}` })),
          word({
            id: 'w2',
            word: 'Hosereel',
            source: 'admin',
            addedBy: { id: 'u2', name: 'Lee' },
          }),
        ],
      }),
    )
    render(<Settings />)
    const panel = await openPrivacyWords()
    await within(panel).findByText('Hosereel')

    fireEvent.change(within(panel).getByLabelText(/^Added by/), { target: { value: 'u2' } })
    fireEvent.change(within(panel).getByLabelText(/^Find on/), { target: { value: 'Default' } })
    expect(within(panel).getByText('Nothing matches.')).toBeInTheDocument()
  })

  it('offers no Added by filter when every word came from one place', async () => {
    mock(true)
    render(<Settings />)
    const panel = await openPrivacyWords()
    await within(panel).findByText('Sprinkl')
    expect(within(panel).queryByLabelText(/^Added by/)).not.toBeInTheDocument()
  })

  it('says the lists take effect only when protection is on (AC9)', async () => {
    mock(true, lists({ protectionOn: false }))
    render(<Settings />)
    const panel = await openPrivacyWords()
    expect(await within(panel).findByText(/take effect only when/)).toBeInTheDocument()
  })

  it('shows who added or removed what and why, newest first (AC7)', async () => {
    const change = { list: 'never' as const, word: 'Hosereel', kind: null, reason: 'equipment' }
    mock(
      true,
      lists({
        history: [
          {
            at: '2026-11-22T05:00:00.000Z',
            by: { id: 'u1', name: 'Sana' },
            before: change,
            after: null,
          },
          {
            at: '2026-11-21T05:00:00.000Z',
            by: { id: 'u2', name: 'Lee' },
            before: null,
            after: change,
          },
        ],
      }),
    )
    render(<Settings />)
    const panel = await openPrivacyWords()
    const items = within(await within(panel).findByRole('list')).getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual([
      '22 Nov 2026, Sana: removed Hosereel from Never masked (equipment)',
      '21 Nov 2026, Lee: added Hosereel to Never masked (equipment)',
    ])
  })
})
