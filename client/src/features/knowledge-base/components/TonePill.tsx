// A small status pill in one of the design system's status colours (v2 section 6: icon + word,
// radius 999): green = done, amber = needs a look, red = failed, blue = under way, grey = waiting.
// Used by components/DocumentStatus.tsx, UploadRow.tsx and UploadedDocuments.tsx. Calls Icon.
import { Icon } from '../../../design-system'

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'violet'

const TONES: Record<Tone, { fg: string; bg: string }> = {
  green: { fg: 'var(--green-600)', bg: 'var(--green-50)' },
  amber: { fg: 'var(--amber-600)', bg: 'var(--amber-50)' },
  red: { fg: 'var(--red-600)', bg: 'var(--red-50)' },
  blue: { fg: 'var(--ink-600)', bg: 'var(--ink-50)' },
  grey: { fg: 'var(--graphite-700)', bg: 'var(--graphite-100)' },
  violet: { fg: 'var(--violet-600)', bg: 'var(--violet-50)' },
}

/** Returns the pill: `icon` (a name, or none) then `children`. */
export function TonePill({
  tone,
  icon,
  children,
}: {
  tone: Tone
  icon?: string
  children: React.ReactNode
}) {
  const t = TONES[tone]
  return (
    <span className="ds-pill" style={{ color: t.fg, background: t.bg }}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  )
}
