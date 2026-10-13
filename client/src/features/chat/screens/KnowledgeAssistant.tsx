// The knowledge assistant screen (CB-01 Step 0): ask the knowledge base in a
// conversation. OpenUI's AgentInterface draws the conversation list, messages
// and composer; answers stream from the gateway via ../api.ts.
// Rendered by AssessmentApp for the 'chat' screen, loaded on first open.
import { AgentInterface } from '@openuidev/react-ui'
import '@openuidev/react-ui/components.css'
import { chatLLM } from '../api'
import { chatTheme } from '../theme'
import '../chat.css'

// ponytail: conversations live in memory until the conversation list's storage
// (CB-03) passes `storage` here; a refresh starts afresh.
export function KnowledgeAssistant() {
  return (
    <div className="knowledge-assistant">
      <AgentInterface llm={chatLLM} theme={{ mode: 'light', lightTheme: chatTheme }} />
    </div>
  )
}
