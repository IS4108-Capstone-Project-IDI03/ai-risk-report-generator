// An unsent typed walk, kept on the device per walk (CP-22 AC2). Used by
// screens/Recording.tsx. Without it, Back or a reload would lose typed text.
// Every access is guarded: storage can be blocked or full, and the screen must still work.
const key = (walkId: string) => `site-walk-draft:${walkId}`

// Returns the saved draft for this walk, or null.
export function readDraft(walkId: string) {
  try {
    return localStorage.getItem(key(walkId))
  } catch {
    return null
  }
}

// Saves the draft; an empty draft is removed.
export function writeDraft(walkId: string, text: string) {
  try {
    if (text) localStorage.setItem(key(walkId), text)
    else localStorage.removeItem(key(walkId))
  } catch {
    // Not saved: the text is still on screen.
  }
}
