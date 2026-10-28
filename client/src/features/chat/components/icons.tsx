// Small line icons for the retry, edit and version controls (CB-04). Decorative: the buttons
// that hold them carry the accessible name.
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** Circular arrow: ask this question again. */
export const RetryIcon = () => (
  <svg {...base}>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

/** Pencil: edit this question. */
export const EditIcon = () => (
  <svg {...base}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)

/** Chevrons for the version switcher. */
export const ChevronLeft = () => (
  <svg {...base} width={14} height={14}>
    <path d="m15 18-6-6 6-6" />
  </svg>
)
export const ChevronRight = () => (
  <svg {...base} width={14} height={14}>
    <path d="m9 18 6-6-6-6" />
  </svg>
)
