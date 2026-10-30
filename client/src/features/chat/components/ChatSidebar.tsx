// The chat screen's sidebar (CB-01): MarshBot's name, a "New chat" row, a search box (CB-03)
// and the "Chats" list.
// The logo and name start a new chat too, as in most chat apps.
// Built from OpenUI's own sidebar parts, placed inside <AgentInterface.Sidebar> by
// screens/KnowledgeAssistant.tsx. OpenUI's default sidebar hardcodes "New Chat" and "Threads"
// with no label props, so this composes the same parts with our words.
import { useThreadList } from '@openuidev/react-headless'
import { AgentInterface } from '@openuidev/react-ui'
import { useState } from 'react'
import { Icon } from '../../../design-system'
import marshbot from '../marshbot.svg'
import { ChatSearch } from './ChatSearch'
import { ChatThreadList } from './ChatThreadList'
import { PreferencesPanel } from './PreferencesPanel'

/** The sidebar's contents: header, a New chat row, then the Chats heading and list. */
export function ChatSidebar() {
  const startNewChat = useThreadList((s) => s.switchToNewThread)
  const hasChats = useThreadList((s) => s.threads.length > 0)
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
            icon={<Icon name="square-pen" />}
            aria-label="New chat"
            onClick={startNewChat}
          >
            New chat
          </AgentInterface.SidebarItem>
          {/* CB-05: the engineer's remembered facts, in a light panel instead of a page. */}
          <AgentInterface.SidebarItem
            icon={<Icon name="settings" />}
            aria-label="My preferences"
            onClick={() => setPreferencesOpen(true)}
          >
            My preferences
          </AgentInterface.SidebarItem>
        </div>
      </div>
      <AgentInterface.SidebarContent>
        <ChatSearch words={words} onChange={setWords} />
        {(hasChats || words) && <h3 className="chat-sidebar-heading">Chats</h3>}
        <ChatThreadList searching={!!words} />
      </AgentInterface.SidebarContent>
      {preferencesOpen && <PreferencesPanel onClose={() => setPreferencesOpen(false)} />}
    </>
  )
}
