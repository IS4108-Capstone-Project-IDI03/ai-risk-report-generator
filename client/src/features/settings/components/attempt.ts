// Runs one action and shows its success or error toast (F-12, Settings > Walkthroughs).
// Called by ConfirmDialog and PracticeRow. Calls the `run` it is given and the toast.
import { toast } from '../../../design-system'

/** Runs the action and shows its success or error toast; resolves true when it worked. */
export async function attempt(run: () => Promise<unknown>, done: string, failed: string) {
  try {
    await run()
    toast.success(done)
    return true
  } catch {
    // Nothing was changed, so the screen stays as it was.
    toast.error(failed, { description: 'Nothing was changed. Please try again.' })
    return false
  }
}
