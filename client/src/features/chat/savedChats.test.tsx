// Tests for the saved-chat list (CB-03): the storage that talks to the gateway, and the
// sidebar list's rename and delete-with-confirm. fetch is stubbed; no gateway runs.
import { ChatProvider, type ChatStorage, type Thread } from '@openuidev/react-headless'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatLLM, chatStorage, setChatSearch } from './api'
import { ChatSearch } from './components/ChatSearch'
import { ChatThreadList } from './components/ChatThreadList'

// jsdom does not implement <dialog>; the shared Dialog opens it with showModal.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setChatSearch('')
})

describe('chat storage (CB-03)', () => {
  it('lists, searches, opens, renames and deletes through the gateway', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      if (url.endsWith('/c1') && init?.method === 'GET')
        return Promise.resolve(
          Response.json({ messages: [{ id: 'm', role: 'user', content: 'Hi' }] }),
        )
      if (init?.method === 'PATCH')
        return Promise.resolve(Response.json({ id: 'c1', title: 'New' }))
      if (init?.method === 'POST')
        return Promise.resolve(Response.json({ id: 'c2', title: 'Q' }, { status: 201 }))
      return Promise.resolve(Response.json({ threads: [{ id: 'c1', title: 'A', createdAt: 't' }] }))
    })
    const { thread } = chatStorage
    expect((await thread.listThreads()).threads).toHaveLength(1)
    setChatSearch('deluge & co')
    await thread.listThreads()
    expect(await thread.getMessages('c1')).toEqual([{ id: 'm', role: 'user', content: 'Hi' }])
    await thread.updateThread({ id: 'c1', title: 'New', createdAt: 't' })
    expect((await thread.createThread({ id: 'u', role: 'user', content: 'Q' })).id).toBe('c2')
    await thread.deleteThread('c1')
    expect(calls).toEqual([
      'GET /api/chat/conversations',
      'GET /api/chat/conversations?q=deluge%20%26%20co',
      'GET /api/chat/conversations/c1',
      'PATCH /api/chat/conversations/c1',
      'POST /api/chat/conversations',
      'DELETE /api/chat/conversations/c1',
    ])
  })
})

// A fake storage that remembers renames and deletes, so the list can be driven without a gateway.
function fakeStorage(threads: Thread[]) {
  const thread = {
    listThreads: vi.fn(async () => ({ threads: [...threads] })),
    createThread: vi.fn(),
    getMessages: vi.fn(async () => []),
    updateThread: vi.fn(async (t: Thread) => t),
    deleteThread: vi.fn(async () => {}),
  }
  return { storage: { thread } as unknown as ChatStorage, thread }
}

describe('chat list (CB-03)', () => {
  const chats: Thread[] = [
    { id: 'c1', title: 'Sprinkler spacing', createdAt: 1 },
    { id: 'c2', title: 'FM-200 notes', createdAt: 2 },
  ]
  const open = async () => {
    const { storage, thread } = fakeStorage(chats)
    render(
      <ChatProvider llm={chatLLM} storage={storage}>
        <ChatThreadList />
      </ChatProvider>,
    )
    await screen.findByText('Sprinkler spacing')
    return thread
  }

  it('lists the chats and says so when a search finds none', async () => {
    await open()
    expect(screen.getByText('FM-200 notes')).toBeInTheDocument()
  })

  it('shows a long name in full on hover, and announces an empty list', async () => {
    await open()
    expect(screen.getByRole('button', { name: 'Sprinkler spacing' })).toHaveAttribute(
      'title',
      'Sprinkler spacing',
    )
    cleanup()
    const { storage } = fakeStorage([])
    render(
      <ChatProvider llm={chatLLM} storage={storage}>
        <ChatThreadList />
      </ChatProvider>,
    )
    expect(await screen.findByRole('status')).toHaveTextContent('No chats yet.')
  })

  it('puts the cursor in the rename box and focus on Cancel in the delete box', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Rename Sprinkler spacing' }))
    await waitFor(() => expect(screen.getByLabelText('Chat name')).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sprinkler spacing' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    )
  })

  it('shows the new name after a rename (AC4)', async () => {
    const thread = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Rename Sprinkler spacing' }))
    const box = await screen.findByLabelText('Chat name')
    fireEvent.change(box, { target: { value: 'Spacing rules' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(thread.updateThread).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', title: 'Spacing rules' }),
      ),
    )
    expect(await screen.findByText('Spacing rules')).toBeInTheDocument()
  })

  it('deletes only after the engineer confirms (AC5)', async () => {
    const thread = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Delete FM-200 notes' }))
    const dialog = await screen.findByRole('dialog')
    expect(thread.deleteThread).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(thread.deleteThread).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete FM-200 notes' }))
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete chat' }),
    )
    await waitFor(() => expect(thread.deleteThread).toHaveBeenCalledWith('c2'))
    await waitFor(() => expect(screen.queryByText('FM-200 notes')).not.toBeInTheDocument())
  })
})

describe('chat search (CB-03 AC3)', () => {
  it('lists the matches while typing, and every chat again once the box is cleared', async () => {
    const all: Thread[] = [
      { id: 'c1', title: 'Sprinkler spacing', createdAt: 1 },
      { id: 'c2', title: 'FM-200 notes', createdAt: 2 },
    ]
    // The real storage, with the gateway's search stubbed.
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      const q = new URL(url, 'http://x').searchParams.get('q')
      asked.push(q ?? '')
      return Response.json({
        threads: all.filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase())),
      })
    })
    function Box() {
      const [words, setWords] = useState('')
      return (
        <>
          <ChatSearch words={words} onChange={setWords} />
          <ChatThreadList searching={!!words} />
        </>
      )
    }
    render(
      <ChatProvider llm={chatLLM} storage={chatStorage}>
        <Box />
      </ChatProvider>,
    )
    await screen.findByText('FM-200 notes')
    const box = screen.getByRole('textbox', { name: 'Search chats' })
    fireEvent.change(box, { target: { value: 'sprink' } })
    await waitFor(() => expect(screen.queryByText('FM-200 notes')).not.toBeInTheDocument())
    expect(screen.getByText('Sprinkler spacing')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '' } })
    expect(await screen.findByText('FM-200 notes')).toBeInTheDocument()
    expect(asked).toEqual(['', 'sprink', ''])
  })
})
