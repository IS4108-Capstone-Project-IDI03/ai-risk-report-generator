// "Ask about this" from the keyboard (AS-02 AC1): Ctrl+Alt+K, Cmd+Option+K on
// a Mac. It sits beside Comment's Ctrl+Alt+M (RV-03) without clashing; K types
// no letter with AltGr on most European layouts, and Chrome and Edge leave it
// free. The document editor binds it as 'Mod-Alt-k' (ProseMirror reads the K
// key on a Mac, where Option changes the letter typed).
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export const ASK_KEYS = {
  keys: ['Mod', 'Alt', 'K'],
  label: MAC ? 'Cmd+Option+K' : 'Ctrl+Alt+K',
  aria: MAC ? 'Meta+Alt+K' : 'Control+Alt+K',
}

// Whether a key press is the shortcut, by the key's place on the keyboard.
export const isAskShortcut = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey && event.code === 'KeyK'
