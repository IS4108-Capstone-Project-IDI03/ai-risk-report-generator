// Retry, edit and version switching for the knowledge assistant (CB-04). The server keeps
// every version in a tree; OpenUI shows one path. This hook cuts OpenUI's messages back to the
// parent and asks again (retry, edit), or loads another path from the gateway (switch).
// Used by components/UserMessage.tsx and components/AnswerBar.tsx; state lives in KnowledgeAssistant.
import { useThread, useThreadList, type Message } from '@openuidev/react-headless'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { fetchView, switchVersion, type Versions } from './api'

/** The versions on screen, set by the controller; empty until loaded. */
export const VersionsContext = createContext<{
  versions: Versions
  setVersions: (v: Versions) => void
}>({ versions: {}, setVersions: () => {} })

/**
 * Re-keys the gateway's versions (by saved message id) to the ids on screen. A streamed answer
 * has an id OpenUI made up, and the chat also holds the search step's tool messages, so ids and
 * counts differ; the Nth question and the Nth answer with text are the same message in both.
 */
export function versionsOnScreen(shown: Message[], saved: Message[], versions: Versions) {
  const text = (m: Message) =>
    (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && !!m.content
  const pair = (role: string) => [
    shown.filter((m) => m.role === role && text(m)),
    saved.filter((m) => m.role === role),
  ]
  const out: Versions = {}
  for (const role of ['user', 'assistant']) {
    const [on, was] = pair(role)
    on.forEach((m, i) => {
      if (was[i] && versions[was[i].id]) out[m.id] = versions[was[i].id]
    })
  }
  return out
}

/** Loads the versions whenever an answer finishes or another chat opens. Renders nothing. */
export function useLoadVersions() {
  const { setVersions } = useContext(VersionsContext)
  const threadId = useThreadList((s) => s.selectedThreadId)
  const running = useThread((s) => s.isRunning)
  const shown = useThread((s) => s.messages)
  const latest = useRef(shown)
  useEffect(() => {
    latest.current = shown
  })
  const count = shown.length
  useEffect(() => {
    if (!threadId || running) return
    // Without this, a chat switched mid-request would show the old chat's switcher.
    let stale = false
    fetchView(threadId)
      .then((view) => {
        if (!stale) setVersions(versionsOnScreen(latest.current, view.messages, view.versions))
      })
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
      // The messages on screen are now the saved ones, so their ids are the saved ids.
      setVersions(view.versions)
    },
    [threadId, running, setMessages, setVersions],
  )
  return { versions, messages, running, resend, switchTo }
}
