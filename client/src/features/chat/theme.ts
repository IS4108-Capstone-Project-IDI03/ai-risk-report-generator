// Maps the design system's tokens onto OpenUI's theme names, so the chat
// screen looks like the rest of the app (docs/design-system.md). Values are
// our CSS variables, so a token change reaches the chat screen too.
import { createTheme } from '@openuidev/react-ui'

/** OpenUI theme overrides drawn from client/src/design-system/tokens. */
export const chatTheme = createTheme({
  background: 'var(--surface-page)',
  foreground: 'var(--surface-card)',
  popoverBackground: 'var(--surface-card)',
  sunk: 'var(--surface-sunken)',
  highlight: 'var(--surface-hover)',
  textNeutralPrimary: 'var(--text-primary)',
  textNeutralSecondary: 'var(--text-secondary)',
  textNeutralTertiary: 'var(--text-muted)',
  textNeutralLink: 'var(--text-link)',
  interactiveAccentDefault: 'var(--ink-600)',
  interactiveAccentHover: 'var(--ink-700)',
  interactiveAccentPressed: 'var(--ink-800)',
  borderDefault: 'var(--border-default)',
  borderInteractive: 'var(--border-default)',
  borderInteractiveEmphasis: 'var(--border-strong)',
  borderInteractiveSelected: 'var(--border-focus)',
  chatUserResponseBg: 'var(--surface-selected)',
  chatUserResponseText: 'var(--text-primary)',
  fontBody: 'var(--font-sans)',
  fontHeading: 'var(--font-sans)',
  fontLabel: 'var(--font-sans)',
  fontCode: 'var(--font-mono)',
  fontNumbers: 'var(--font-mono)',
  // 8px is the system's largest radius; nothing is pill-shaped but dots and toggles.
  radiusS: 'var(--radius-xs)',
  radiusM: 'var(--radius-sm)',
  radiusL: 'var(--radius-md)',
  radiusXl: 'var(--radius-lg)',
  radius2xl: 'var(--radius-lg)',
  shadowS: 'var(--shadow-sm)',
  shadowM: 'var(--shadow-sm)',
})
