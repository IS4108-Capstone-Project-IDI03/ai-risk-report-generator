// The saved chats in the sidebar (CB-03), loaded from the gateway and shown newest first, in
// recency groups (Today, Yesterday, Previous 7 days, Older) under small quiet labels, as chat
// apps list them. Used by ChatSidebar. Each row is a ChatThreadRow; groups come from ../chatGroups.ts.
import { useThreadList } from '@openuidev/react-headless'
import { useEffect } from 'react'
import { groupByRecency } from '../chatGroups'
import { ChatThreadRow } from './ChatThreadRow'

/** Loads the engineer's chats once and lists them by recency, or says when there are none. */
export function ChatThreadList({ searching = false }: { searching?: boolean }) {
  const threads = useThreadList((s) => s.threads)
  const loading = useThreadList((s) => s.isLoadingThreads)
  const failed = useThreadList((s) => s.threadListError)
  const load = useThreadList((s) => s.loadThreads)
  useEffect(() => {
    load()
  }, [load])
  if (failed)
    return (
      <p className="chat-thread-note" role="alert">
        Chats could not be loaded. Try again later.
      </p>
    )
  if (loading && !threads.length)
    return (
      <p className="chat-thread-note" role="status">
        Loading chats…
      </p>
    )
  if (!threads.length)
    return (
      <p className="chat-thread-note" role="status">
        {searching ? 'No chats match.' : 'No chats yet.'}
      </p>
    )
  return (
    <nav aria-label="Chats" className="chat-thread-list">
      {groupByRecency(threads).map((group) => (
        <section key={group.label} className="chat-thread-group" aria-label={group.label}>
          <h3 className="chat-thread-group-label">{group.label}</h3>
          {group.items.map((t) => (
            <ChatThreadRow key={t.id} id={t.id} title={t.title} createdAt={t.createdAt} />
          ))}
        </section>
      ))}
    </nav>
  )
}
