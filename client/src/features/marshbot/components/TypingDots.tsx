// MarshBot typing (AS-06 board 12): three dots, each pulsing over 1.2 s, 0.2 s apart, like the
// chatbot's searching line; with a label while it checks something ("Checking what your
// observations cover"). Used by screens/MarshBotOverview.tsx.

/** Returns the typing bubble, with its label when given. */
export function TypingDots({ label }: { label?: string }) {
  return (
    <div className="mb-typing" role="status">
      <span className="mb-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {/* The words themselves are what a screen reader announces. */}
      {label ? <span>{label}</span> : <span className="mb-sr">MarshBot is typing</span>}
    </div>
  )
}
