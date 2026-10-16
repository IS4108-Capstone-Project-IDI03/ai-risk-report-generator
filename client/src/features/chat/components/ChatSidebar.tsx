// The chat screen's sidebar (CB-01): MarshBot's name, a "New chat" row and the "Chats" list.
// Built from OpenUI's own sidebar parts, placed inside <AgentInterface.Sidebar> by
// screens/KnowledgeAssistant.tsx. OpenUI's default sidebar hardcodes "New Chat" and "Threads"
// with no label props, so this composes the same parts with our words.
import { useThreadList } from '@openuidev/react-headless'
import { AgentInterface } from '@openuidev/react-ui'
import { Icon } from '../../../design-system'

/** The sidebar's contents: header, a New chat row, then the Chats heading and list. */
export function ChatSidebar() {
  const startNewChat = useThreadList((s) => s.switchToNewThread)
  const hasChats = useThreadList((s) => s.threads.length > 0)
  return (
    <>
      <div className="openui-agent-sidebar-actions">
        <AgentInterface.SidebarHeader />
        <div className="openui-agent-sidebar-primary-actions">
          {/* The label names the button when the sidebar is collapsed to icons. */}
          <AgentInterface.SidebarItem
            icon={<Icon name="square-pen" />}
            aria-label="New chat"
            onClick={startNewChat}
          >
            New chat
          </AgentInterface.SidebarItem>
        </div>
      </div>
      <AgentInterface.SidebarContent>
        {hasChats && <h3 className="chat-sidebar-heading">Chats</h3>}
        <AgentInterface.ThreadList />
      </AgentInterface.SidebarContent>
    </>
  )
}
