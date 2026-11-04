// Open sheets and popovers form a stack so only the topmost one answers Esc and Tab, and the page
// behind is locked while any is open. Called by Sheet and Popover. CP-23 check fixes C8, C10.
import { useCallback, useEffect, useRef } from 'react'

const stack: symbol[] = []

// Locks scroll and makes the app root inert while a sheet is open; undone when the last closes.
function lock(on: boolean) {
  const root = document.getElementById('root')
  document.body.style.overflow = on ? 'hidden' : ''
  if (on) root?.setAttribute('inert', '')
  else root?.removeAttribute('inert')
}

/** Registers this overlay while `active`; returns a function that is true while it is the topmost. */
export function useOverlayStack(active: boolean, modal = false) {
  const id = useRef(Symbol('overlay'))
  useEffect(() => {
    if (!active) return
    const me = id.current
    stack.push(me)
    if (modal) lock(true)
    return () => {
      stack.splice(stack.indexOf(me), 1)
      if (modal && !stack.length) lock(false)
    }
  }, [active, modal])
  return useCallback(() => stack[stack.length - 1] === id.current, [])
}
