// Closing the chats drawer on a phone (CB-01). Called by components/ChatThreadRow.tsx and
// components/ChatSidebar.tsx after a chat is picked or started. Kept apart so those component
// files export only components (fast refresh).

/** Closes the chats drawer on a phone after a pick, as OpenUI's own row does; no-op on wider screens. */
// shortcut: OpenUI keeps its sidebar setter private, so this clicks the drawer's backdrop (which
// closes it); call the setter instead if OpenUI exports it. Without this, the opened chat stayed
// hidden behind the drawer.
export function closeChatsDrawer() {
  document
    .querySelector<HTMLElement>(
      '.openui-agent-sidebar-container__overlay:not(.openui-agent-sidebar-container__overlay--collapsed)',
    )
    ?.click()
}
