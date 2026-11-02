// The toast after deleting a proposed observation (CP-22 round 1): "Observation
// deleted" with Undo, gone after 10 seconds, double the design system's
// default, so there is time to reach Undo. Used by screens/Review.tsx.
import { Toast } from '../../../design-system'

// Offers Undo for the most recently deleted proposed observation.
export function UndoToast({ onUndo, onDismiss }: { onUndo: () => void; onDismiss: () => void }) {
  return (
    <div className="swr-toast">
      <Toast
        tone="info"
        message="Observation deleted."
        action={
          <button type="button" className="swr-undo" onClick={onUndo}>
            Undo
          </button>
        }
        onDismiss={onDismiss}
        autoCloseMs={10_000}
      />
    </div>
  )
}
