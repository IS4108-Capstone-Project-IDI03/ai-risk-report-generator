// The toasts' green tick (CP-23 round 13): lucide's circle-check with the tick raised
// 0.4 units, since its weight sits in the bottom of the V and the stock one reads low
// in the circle. An inline SVG, as Icon draws lucide glyphs as CSS masks and can't take
// a custom path. Used by notify.tsx (Sonner) and Toast.tsx (the older toast).

/** Returns the 18 px green success tick at its optical centre. */
export function SuccessIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--green-600)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 11.6 2 2 4-4" />
    </svg>
  )
}
