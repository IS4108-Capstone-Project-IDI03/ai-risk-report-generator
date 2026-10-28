// Tests for retry, edit and the version switcher (CB-04). fetch is stubbed; no gateway runs.
import {
  ChatProvider,
  useThreadList,
  type ChatStorage,
  type UserMessage as UserMsg,
} from '@openuidev/react-headless'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatLLM } from './api'
import { AnswerBar } from './components/AnswerBar'
import { UserMessage } from './components/UserMessage'
import { VersionsContext, savedIds } from './useVersions'

// fetchLLM binds globalThis.fetch once, when api.ts loads, so the mock must be in place before
// that import (vi.hoisted runs first). Without this, chatLLM would call the real fetch.
const fetchMock = vi.hoisted(() => (globalThis.fetch = vi.fn()) as ReturnType<typeof vi.fn>)

afterEach(cleanup)

const path = [
  { id: 'q1', role: 'user' as const, content: 'Spacing?' },
  { id: 'a2', role: 'assistant' as const, content: 'second answer' },
]
const versions = { a2: { ids: ['a1', 'a2'], index: 1 }, q1: { ids: ['q1', 'q0'], index: 0 } }

// Opens chat c1 (messages = `path`) with the CB-04 controls, and records every request made.
function setup() {
  const requests: {
    method: string
    url: string
    body: { threadId?: string; messages: { content: string }[] } | undefined
  }[] = []
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method: init?.method ?? 'GET', url, body })
    if (url === '/api/chat')
      return Promise.resolve(new Response('', { headers: { 'Content-Type': 'text/event-stream' } }))
    if (init?.method === 'PATCH')
      return Promise.resolve(Response.json({ messages: [path[0]], versions: {} }))
    return Promise.resolve(Response.json({ messages: path, versions }))
  })
  const storage = {
    thread: {
      listThreads: async () => ({ threads: [{ id: 'c1', title: 'Chat', createdAt: 1 }] }),
      createThread: vi.fn(),
      getMessages: async () => path,
      updateThread: vi.fn(),
      deleteThread: vi.fn(),
    },
  } as unknown as ChatStorage
  function Open() {
    const select = useThreadList((s) => s.selectThread)
    useEffect(() => select('c1'), [select])
    return null
  }
  function Screen() {
    const [v, setV] = useState({})
    return (
      <VersionsContext.Provider value={{ versions: v, setVersions: setV }}>
        <Open />
        <UserMessage message={path[0] as UserMsg} />
        <AnswerBar />
      </VersionsContext.Provider>
    )
  }
  render(
    <ChatProvider llm={chatLLM} storage={storage}>
      <Screen />
    </ChatProvider>,
  )
  return requests
}

describe('retry, edit and versions (CB-04)', () => {
  it('shows which version is on screen and switches to the other (AC1)', async () => {
    const requests = setup()
    expect(await screen.findByText('2/2')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Previous answer' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PATCH',
        url: '/api/chat/conversations/c1/active',
        body: { messageId: 'a1' },
      }),
    )
  })

  it('Try again asks the same question again from just before it (AC1)', async () => {
    const requests = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(requests.some((r) => r.url === '/api/chat')).toBe(true))
    const sent = requests.find((r) => r.url === '/api/chat')!.body
    expect(sent?.threadId).toBe('c1')
    // Only the question: the answer being retried is not sent (AC4).
    expect(sent?.messages.map((m: { content: string }) => m.content)).toEqual(['Spacing?'])
  })

  it('an edited question is sent in place of the old one, with the same earlier messages (AC2)', async () => {
    const requests = setup()
    await screen.findByRole('button', { name: 'Try again' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit question' }))
    fireEvent.change(screen.getByLabelText('Edit your question'), {
      target: { value: 'Spacing for EH2?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(requests.some((r) => r.url === '/api/chat')).toBe(true))
    const sent = requests.find((r) => r.url === '/api/chat')!.body
    expect(sent?.threadId).toBe('c1')
    expect(sent?.messages.map((m: { content: string }) => m.content)).toEqual(['Spacing for EH2?'])
  })
})

describe('saved ids (CB-04)', () => {
  it('matches streamed messages to saved ones by order, skipping tool messages', () => {
    const shown = [
      { id: 'u-live', role: 'user', content: 'Q' },
      { id: 'tool-call', role: 'assistant', content: '' },
      { id: 'tool', role: 'tool', content: '{}', toolCallId: 't' },
      { id: 'a-live', role: 'assistant', content: 'A' },
    ] as never[]
    const saved = [
      { id: 'u-saved', role: 'user', content: 'Q' },
      { id: 'a-saved', role: 'assistant', content: 'A' },
    ] as never[]
    expect(savedIds(shown, saved)).toEqual(
      new Map([
        ['u-live', 'u-saved'],
        ['a-live', 'a-saved'],
      ]),
    )
  })

  it('pairs nothing when a message was not saved', () => {
    const shown = [{ id: 'u', role: 'user', content: 'Q' }] as never[]
    expect(savedIds(shown, [])).toBeNull()
  })
})
