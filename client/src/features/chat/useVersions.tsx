// Retry, edit and version switching for the knowledge assistant (CB-04). The server keeps
// every version in a tree; OpenUI shows one path. This hook cuts OpenUI's messages back to the
// parent and asks again (retry, edit), or loads another path from the gateway (switch).
// Used by components/UserMessage.tsx and components/AnswerBar.tsx; state lives in KnowledgeAssistant.
import { useThread, useThreadList } from '@openuidev/react-headless'
import { createContext, useCallback, useContext, useEffect } from 'react'
import { fetchVersions, switchVersion, type Versions } from './api'

/** The versions on screen, set by the controller; empty until loaded. */
export const VersionsContext = createContext<{
  versions: Versions
  setVersions: (v: Versions) => void
}>({ versions: {}, setVersions: () => {} })

/** Loads the versions whenever an answer finishes or another chat opens. Renders nothing. */
export function useLoadVersions() {
  const { setVersions } = useContext(VersionsContext)
  const threadId = useThreadList((s) => s.selectedThreadId)
  const running = useThread((s) => s.isRunning)
  const count = useThread((s) => s.messages.length)
  useEffect(() => {
    if (!threadId || running) return
    // Without this, a chat switched mid-request would show the old chat's switcher.
    let stale = false
    fetchVersions(threadId)
      .then((v) => !stale && setVersions(v))
      .catch(() => !stale && setVersions({}))
    return () => {
      stale = true
    }
  }, [threadId, running, count, setVersions])
}

/** Returns the versions on screen and the actions that change them. */
export function useVersions() {
  const { versions, setVersions } = useContext(VersionsContext)
  const threadId = useThreadList((s) => s.selectedThreadId)
  const messages = useThread((s) => s.messages)
  const running = useThread((s) => s.isRunning)
  const setMessages = useThread((s) => s.setMessages)
  const processMessage = useThread((s) => s.processMessage)

  // Asks `content` again as a new version of the message `messageId`: the chat is cut back to
  // just before it, so the follow-up the server sees has the same parent (server/src/services/chat-save.service.ts).
  const resend = useCallback(
    async (messageId: string, content: string) => {
      const at = messages.findIndex((m) => m.id === messageId)
      if (at < 0 || running) return
      setMessages(messages.slice(0, at))
      await processMessage({ role: 'user', content })
    },
    [messages, running, setMessages, processMessage],
  )
  const switchTo = useCallback(
    async (messageId: string) => {
      if (!threadId || running) return
      const view = await switchVersion(threadId, messageId)
      setMessages(view.messages)
      setVersions(view.versions)
    },
    [threadId, running, setMessages, setVersions],
  )
  return { versions, messages, running, resend, switchTo }
}
