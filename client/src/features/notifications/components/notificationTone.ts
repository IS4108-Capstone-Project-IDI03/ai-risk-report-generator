// Colours for a notification's context status. CB-07 UI polish. Used by NotificationIcon.

const RED = { fg: 'var(--status-critical-fg)', bg: 'var(--status-critical-bg)' }
const AMBER = { fg: 'var(--status-moderate-fg)', bg: 'var(--status-moderate-bg)' }
const GREEN = { fg: 'var(--status-low-fg)', bg: 'var(--status-low-bg)' }
const NAVY = { fg: 'var(--ink-600)', bg: 'var(--ink-50)' }
const GRAPHITE = { fg: 'var(--text-secondary)', bg: 'var(--graphite-100)' }

// Context statuses by tone. Anything else (no status, a new request) is navy.
const TONES: [string[], { fg: string; bg: string }][] = [
  [['failed', 'error'], RED],
  [['needs_review', 'warning', 'withdrawn', 'due_soon'], AMBER],
  [['complete', 'filled', 'done', 'ready'], GREEN],
  [['dismissed'], GRAPHITE],
]

/** Returns the colours for a context status: red, amber, green, graphite, else navy. */
export function toneFor(status: string | undefined) {
  return TONES.find(([statuses]) => status && statuses.includes(status))?.[1] ?? NAVY
}
