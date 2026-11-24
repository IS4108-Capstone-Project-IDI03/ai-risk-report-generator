// A citation number in the draft or in a claim (RV-01). Selecting it opens
// its source in the panel beside the draft; the open one stays marked.
export function CitationMark({
  number,
  label,
  current,
  onSelect,
  walk,
}: {
  number: number
  label: string
  current: boolean
  onSelect: () => void
  // The walkthrough tag (F-12), as data-walk: set on Finding 1's first citation only.
  walk?: string
}) {
  return (
    <button
      type="button"
      className="rv-cite"
      aria-label={`Citation ${number}: ${label}`}
      aria-current={current ? 'true' : undefined}
      data-walk={walk}
      onClick={onSelect}
    >
      {number}
    </button>
  )
}
