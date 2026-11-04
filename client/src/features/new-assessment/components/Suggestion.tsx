// "Did you mean …?" under a new client or site name close to a listed one
// (CP-17 AC11, kept by CP-23). Non-blocking: Create keeps the name as typed.
// Used by ClientCard.tsx and SiteCard.tsx.
export function Suggestion({
  name,
  onUse,
}: {
  name: string | null
  onUse: (name: string) => void
}) {
  if (!name) return null
  return (
    <p className="na-suggest" role="status">
      {'Did you mean '}
      {/* The "?" sits inside the button so a long name wraps with it, left-aligned. */}
      <button type="button" dir="auto" onClick={() => onUse(name)}>
        {name + '?'}
      </button>
    </p>
  )
}
