// MarshBot typing (AS-06 board 12): three dots, each pulsing over 1.2 s, 0.2 s apart, like the
// chatbot's searching line; with a label while it checks something ("Checking what your
// observations cover"). Hidden from assistive tech: it sits inside the thread's live log, and a
// second live region would announce "typing" between every paced message. Used by
// components/thread/Thread.tsx.

/** Returns the typing bubble, with its label when given. */
export function TypingDots({ label }: { label?: string }) {
  return (
    <div className="mb-typing" aria-hidden="true">
      <span className="mb-dots">
        <i />
        <i />
        <i />
      </span>
      {label && <span>{label}</span>}
    </div>
  )
}
