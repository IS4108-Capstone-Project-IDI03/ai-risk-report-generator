// The sidebar's search box for saved chats (CB-03 AC3). Used by ChatSidebar.
// Sets the words api.ts's chat storage searches for, then reloads the list.
import { useThreadList } from '@openuidev/react-headless'
import { useEffect, useRef } from 'react'
import { Input } from '../../../design-system'
import { setChatSearch } from '../api'

type Props = { words: string; onChange: (words: string) => void }

/** A search box; the list reloads 250 ms after typing stops, and again when the box is cleared. */
export function ChatSearch({ words, onChange }: Props) {
  const loadChats = useThreadList((s) => s.loadThreads)
  // The list loads itself on mount, so the first run (an untouched box) must not reload it too.
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) return
    const timer = setTimeout(() => {
      setChatSearch(words)
      loadChats()
    }, 250)
    return () => clearTimeout(timer)
  }, [words, loadChats])
  // Leaving the screen clears the search, so the next visit lists every chat.
  useEffect(() => () => setChatSearch(''), [])
  return (
    <Input
      size="sm"
      iconLeft="search"
      aria-label="Search chats"
      placeholder="Search chats"
      value={words}
      onChange={(e) => {
        touched.current = true
        onChange(e.target.value)
      }}
    />
  )
}
