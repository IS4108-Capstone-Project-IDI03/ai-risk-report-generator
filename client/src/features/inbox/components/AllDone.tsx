// The To do tab's empty state (F-10, board 04): a green tick and "All done". After the last
// row leaves, the tick draws and the words rise 4 px. Used by InboxList. Same circle and tick
// as SuccessIcon, drawn larger so the tick can be animated.
export function AllDone({ draw }: { draw: boolean }) {
  return (
    <div className="inbox-empty" data-draw={draw || undefined}>
      <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="m9 11.6 2 2 4-4" />
      </svg>
      <p>All done</p>
    </div>
  )
}
