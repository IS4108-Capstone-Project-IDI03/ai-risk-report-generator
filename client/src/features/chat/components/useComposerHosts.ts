// Finds OpenUI's chat box so voice and photo buttons can be drawn inside it (CB-08, CB-10).
// OpenUI draws the box after our components, so it is looked for again whenever the page changes.
// Used by components/VoiceInput.tsx and components/PhotoAttach.tsx.
import { useEffect, useState } from 'react'

const COMPOSER = '.knowledge-assistant .openui-agent-thread-composer'
export const COMPOSER_BOX = `${COMPOSER} textarea`

/** `card` is the rounded input (buttons go inside it); `below` is the area under it (messages). */
export function useComposerHosts() {
  const [hosts, setHosts] = useState<{ card: Element | null; below: Element | null }>({
    card: null,
    below: null,
  })
  useEffect(() => {
    const find = () => {
      const card = document.querySelector(`${COMPOSER}__input-wrapper`)
      const below = document.querySelector(COMPOSER)
      setHosts((was) => (was.card === card && was.below === below ? was : { card, below }))
    }
    find()
    const watch = new MutationObserver(find)
    watch.observe(document.body, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [])
  return hosts
}
