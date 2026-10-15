// Maps the design system's colour tokens onto OpenUI's theme names, so the chat
// screen keeps Marsh's colours (docs/design-system.md). Values are our CSS
// variables, so a token change reaches the chat screen too.
// Apple-style trial (Jesper, 15 Oct), chat screen only: the system font and rounder
// corners replace the design system's Plex Sans and 8px cap here; see chat.css.
import { createTheme } from '@openuidev/react-ui'

/** OpenUI theme overrides: design-system colours, Apple-style type and corners. */
export const chatTheme = createTheme({
  background: 'var(--surface-card)',
  foreground: 'var(--surface-card)',
  popoverBackground: 'var(--surface-card)',
  sunk: 'var(--chat-sidebar)',
  highlight: 'var(--chat-hover)',
  textNeutralPrimary: 'var(--text-primary)',
  textNeutralSecondary: 'var(--text-secondary)',
  textNeutralTertiary: 'var(--text-muted)',
  textNeutralLink: 'var(--text-link)',
  interactiveAccentDefault: 'var(--marsh-navy)',
  interactiveAccentHover: 'var(--ink-800)',
  interactiveAccentPressed: 'var(--ink-700)',
  borderDefault: 'var(--border-default)',
  borderInteractive: 'var(--border-default)',
  borderInteractiveEmphasis: 'var(--ink-300)',
  borderInteractiveSelected: 'var(--border-focus)',
  chatUserResponseBg: 'var(--ink-50)',
  chatUserResponseText: 'var(--text-primary)',
  fontBody: 'var(--chat-font)',
  fontHeading: 'var(--chat-font)',
  fontLabel: 'var(--chat-font)',
  fontCode: 'var(--font-mono)',
  fontNumbers: 'var(--chat-font)',
  radiusS: '6px',
  radiusM: '10px',
  radiusL: '14px',
  radiusXl: '16px',
  radius2xl: '18px',
  shadowS: 'var(--chat-shadow-sm)',
  shadowM: 'var(--chat-shadow-md)',
})
