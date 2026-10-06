// A citation number in the draft or in a claim (RV-01). Selecting it opens
// its source in the panel beside the draft; the open one stays marked.
export function CitationMark({
  number,
  label,
  current,
  onSelect,
}: {
  number: number
  label: string
  current: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className="rv-cite"
      aria-label={`Citation ${number}: ${label}`}
      aria-current={current ? 'true' : undefined}
      onClick={onSelect}
    >
      {number}
    </button>
  )
}
