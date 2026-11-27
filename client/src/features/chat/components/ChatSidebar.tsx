// The chat screen's sidebar (CB-01), laid out like the big chat apps' sidebars: MarshBot's name
// and the collapse button, a prominent "New chat" row, a search box (CB-03), the chats grouped by
// recency, and "My preferences" (CB-05) pinned to the foot like their settings row.
// The logo and name start a new chat too, as in most chat apps.
// Built from OpenUI's own sidebar parts, placed inside <AgentInterface.Sidebar> by
// screens/KnowledgeAssistant.tsx. OpenUI's default sidebar hardcodes "New Chat" and "Threads"
// with no label props, so this composes the same parts with our words. Styles: ../sidebar.css.
import { useThreadList } from '@openuidev/react-headless'
import { AgentInterface } from '@openuidev/react-ui'
import { useState } from 'react'
import { Icon } from '../../../design-system'
import marshbot from '../marshbot.svg'
import { ChatSearch } from './ChatSearch'
import { ChatThreadList } from './ChatThreadList'
import { closeChatsDrawer } from '../chatsDrawer'
import { PreferencesPanel } from './PreferencesPanel'

/** The sidebar's contents: header, New chat, search, the grouped chats, then My preferences. */
export function ChatSidebar() {
  const switchToNewThread = useThreadList((s) => s.switchToNewThread)
  const startNewChat = () => {
    switchToNewThread()
    closeChatsDrawer()
  }
  const [words, setWords] = useState('')
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  return (
    <>
      <div className="openui-agent-sidebar-actions">
        {/* Logo and name are one button passed into OpenUI's header, beside its own collapse
            button; wrapping the whole header would put a button inside a button. */}
        <AgentInterface.SidebarHeader
          logo={
            <button
              type="button"
              className="chat-brand"
              aria-label="MarshBot, new chat"
              onClick={startNewChat}
            >
              <img src={marshbot} alt="" className="openui-agent-sidebar-header__logo" />
              <span className="openui-agent-sidebar-header__agent-name">MarshBot</span>
            </button>
          }
          agentName={false}
        />
        <div className="openui-agent-sidebar-primary-actions">
          {/* The label names the button when the sidebar is collapsed to icons. */}
          <AgentInterface.SidebarItem
            className="chat-new"
            icon={<Icon name="plus" />}
            aria-label="New chat"
            onClick={startNewChat}
          >
            New chat
          </AgentInterface.SidebarItem>
        </div>
      </div>
      <AgentInterface.SidebarContent>
        <ChatSearch words={words} onChange={setWords} />
        <ChatThreadList searching={!!words} />
      </AgentInterface.SidebarContent>
      {/* CB-05: the engineer's remembered facts, in a light panel instead of a page. */}
      <div className="chat-sidebar-foot">
        <AgentInterface.SidebarItem
          icon={<Icon name="settings" />}
          aria-label="My preferences"
          onClick={() => setPreferencesOpen(true)}
        >
          My preferences
        </AgentInterface.SidebarItem>
      </div>
      {preferencesOpen && <PreferencesPanel onClose={() => setPreferencesOpen(false)} />}
    </>
  )
}
