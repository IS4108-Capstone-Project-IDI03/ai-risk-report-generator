// Closes the citation source panel when the engineer opens another chat or a new one (CB-01).
// Rendered inside AgentInterface (screens/KnowledgeAssistant.tsx), where OpenUI's chat state lives.
import { useThreadList } from '@openuidev/react-headless'
import { useContext, useEffect, useRef } from 'react'
import { CitationSelectionContext } from './citationSelection'

/** Renders nothing; closes the open citation when the selected chat changes. */
export function CloseOnChatChange() {
  const chat = useThreadList((s) => s.selectedThreadId)
  const { selected, close } = useContext(CitationSelectionContext)
  const last = useRef(chat)
  useEffect(() => {
    if (chat === last.current) return
    last.current = chat
    // Without this, the panel kept showing a citation from the chat just left.
    if (selected) close()
  }, [chat, selected, close])
  return null
}
