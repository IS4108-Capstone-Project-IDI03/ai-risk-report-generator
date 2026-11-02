// A small toast on the Recording screen (CP-22 round 1): "Recording saved" and
// the cap message. Uses the design system's Toast; sits above the Finish button
// and the camera. Used by screens/Recording.tsx.
import { Toast } from '../../../design-system'

export type WalkToastState = { stamp: number; message: string }

// Shows confirmation after saving or reaching the recording cap.
export function WalkToast({ toast, onDismiss }: { toast: WalkToastState; onDismiss: () => void }) {
  // Keyed by stamp so a new toast starts fresh, even with the same words or while
  // the last one is fading out.
  return (
    <div key={toast.stamp} className="sw-toast">
      <Toast tone="success" message={toast.message} onDismiss={onDismiss} />
    </div>
  )
}
