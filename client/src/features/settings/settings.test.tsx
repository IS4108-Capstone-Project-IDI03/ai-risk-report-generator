// Tests for the Settings screen (S-01). Fetch is mocked; no gateway or paid call.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelOption, ModelRowData, Settings as SettingsData } from './api'
import { Settings } from './Settings'

const opt = (id: string, o: Partial<ModelOption> = {}): ModelOption => ({
  id,
  provider: id.split(':')[0],
  model: id,
  label: id,
  recommended: false,
  keySet: true,
  greyed: false,
  selectable: true,
  note: null,
  ...o,
})
const row = (task: string, o: Partial<ModelRowData> = {}): ModelRowData => ({
  task,
  label: task,
  fixed: false,
  selected: 'a:one',
  warning: null,
  options: [
    opt('a:one', { recommended: true }),
    opt('b:two', { keySet: false, greyed: true, selectable: false }),
  ],
  ...o,
})
const data = (
  canEditGlobal: boolean,
  models: ModelRowData[] = [row('Drafting')],
): SettingsData => ({
  canEditGlobal,
  models,
  qaStrictness: 'standard',
  personal: {
    standardsTargetPct: { value: 50, own: null, default: 50 },
    defaultCountry: { value: null, own: null, default: null },
    defaultFacilityType: { value: null, own: null, default: null },
    defaultTitle: { value: null, own: null, default: null },
  },
})
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

function mock(
  start: SettingsData,
  extra: (url: string, init?: RequestInit) => Promise<Response> | null = () => null,
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const handled = extra(url, init)
    if (handled) return handled
    if (url === '/api/chat/memory')
      return reply(200, { enabled: true, facts: [], maxFacts: 5, maxChars: 200 })
    return reply(200, start)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const open = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings', () => {
  it('shows every section to an engineer and an admin', async () => {
    for (const edit of [false, true]) {
      mock(data(edit))
      render(<Settings />)
      for (const name of [
        'Password',
        'Models',
        'Drafting',
        'QA check',
        'Chat and voice',
        'Defaults',
        'Checklist',
        'Source priority',
        'Note-taking',
        'QA criteria',
      ])
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      cleanup()
    }
  })

  it('shows Coming soon with no controls', async () => {
    mock(data(false))
    render(<Settings />)
    open('Checklist')
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('shows key lights with text, and a no-key option cannot be chosen', async () => {
    const fetchMock = mock(data(true))
    render(<Settings />)
    open('Models')
    const box = await screen.findByRole('combobox', { name: 'Drafting' })
    expect(box).toHaveTextContent('a:one (recommended)')
    fireEvent.click(box)
    const list = screen.getByRole('listbox')
    const none = within(list).getByRole('option', { name: /b:two/ })
    expect(none).toHaveTextContent('No API key')
    expect(none).toHaveAttribute('aria-disabled', 'true')
    expect(none.querySelector('.st-light--off')).not.toBeNull()
    expect(
      within(list).getByRole('option', { name: /a:one/ }).querySelector('.st-light--on'),
    ).not.toBeNull()
    fireEvent.click(none)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('closes an open list when you click elsewhere, even where a click does not move focus (Safari)', async () => {
    mock(data(true))
    render(<Settings />)
    open('Models')
    fireEvent.click(await screen.findByRole('combobox', { name: 'Drafting' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('lets an admin choose a same-provider QA option and sends the PUT', async () => {
    const qa = row('QA check', {
      options: [
        opt('a:one', { recommended: true }),
        opt('c:same', {
          greyed: true,
          selectable: true,
          note: 'Same provider as report generation',
        }),
      ],
    })
    const after = data(true, [
      { ...qa, selected: 'c:same', warning: 'QA would not be independent.' },
    ])
    const fetchMock = mock(data(true, [qa]), (url, init) =>
      init?.method === 'PUT' ? reply(200, after) : null,
    )
    render(<Settings />)
    open('Models')
    fireEvent.click(await screen.findByRole('combobox', { name: 'QA check' }))
    const same = screen.getByRole('option', { name: /c:same/ })
    expect(same).toHaveTextContent('Same provider as report generation')
    expect(same).not.toHaveAttribute('aria-disabled')
    fireEvent.click(same)
    await screen.findByText('QA would not be independent.')
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe('/api/settings/models/QA%20check')
    expect(put[1]?.body).toBe(JSON.stringify({ option: 'c:same' }))
    expect(screen.getByRole('combobox', { name: 'QA check' })).toHaveTextContent('c:same')
  })

  it('shows a row warning, and a fixed task has one option and cannot change', async () => {
    const whisper = row('Voice transcription', {
      fixed: true,
      options: [opt('a:one', { recommended: true })],
    })
    mock(data(true, [row('Drafting', { warning: 'This model cannot be used.' }), whisper]))
    render(<Settings />)
    open('Models')
    expect(await screen.findByText('This model cannot be used.')).toBeInTheDocument()
    const box = screen.getByRole('combobox', { name: 'Voice transcription' })
    expect(box).toBeDisabled()
    expect(box).toHaveTextContent('a:one (recommended)')
  })

  it('makes engineer controls read-only', async () => {
    mock(data(false))
    render(<Settings />)
    open('Models')
    expect(await screen.findByRole('combobox', { name: 'Drafting' })).toBeDisabled()
    expect(screen.getByText('Set by an admin')).toBeInTheDocument()
    open('QA check')
    expect(screen.getByRole('radio', { name: 'Strict' })).toBeDisabled()
    open('Drafting')
    expect(screen.queryByLabelText(/Default for everyone/)).toBeNull()
  })

  it('shows the memory switch from the chat API', async () => {
    mock(data(false))
    render(<Settings />)
    open('Chat and voice')
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
  })

  it('shows password field errors and the lockout message', async () => {
    let n = 0
    mock(data(false), (url) => {
      if (url !== '/api/auth/change-password') return null
      return n++ === 0
        ? reply(400, { error: 'Wrong.', fields: { currentPassword: 'Current password is wrong.' } })
        : reply(429, { error: 'Too many tries. Try again later.' })
    })
    render(<Settings />)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Current password is wrong.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries')
  })
})
