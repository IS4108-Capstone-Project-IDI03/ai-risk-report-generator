// The saved chats in the sidebar (CB-03), loaded from the gateway and shown newest first.
// Used by ChatSidebar. Each row is a ChatThreadRow.
import { useThreadList } from '@openuidev/react-headless'
import { useEffect } from 'react'
import { ChatThreadRow } from './ChatThreadRow'

/** Loads the engineer's chats once and lists them, or says when there are none. */
export function ChatThreadList({ searching = false }: { searching?: boolean }) {
  const threads = useThreadList((s) => s.threads)
  const loading = useThreadList((s) => s.isLoadingThreads)
  const failed = useThreadList((s) => s.threadListError)
  const load = useThreadList((s) => s.loadThreads)
  useEffect(() => {
    load()
  }, [load])
  if (failed) return <p className="chat-thread-note">Chats could not be loaded. Try again later.</p>
  if (loading && !threads.length) return <p className="chat-thread-note">Loading chats…</p>
  if (!threads.length)
    return <p className="chat-thread-note">{searching ? 'No chats match.' : 'No chats yet.'}</p>
  return (
    <nav aria-label="Chats" className="chat-thread-list">
      {threads.map((t) => (
        <ChatThreadRow key={t.id} id={t.id} title={t.title} />
      ))}
    </nav>
  )
}
