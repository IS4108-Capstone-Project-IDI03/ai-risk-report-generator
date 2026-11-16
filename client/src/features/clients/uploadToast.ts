// What an upload says in toasts (CP-23 AC15, AS-06): how many files were kept, and why any were
// refused. Called by screens/DocumentsTab.tsx and marshbot/components/DetailsDocuments.tsx.
import { toast } from '../../design-system'
import type { UploadedFile } from './api'
import { plural } from './formatClient'

/** Shows the toasts for an upload's results (in the toaster `toasterId`, or the app's own); returns how many files were kept. */
export function toastUploadResults(results: UploadedFile[], toasterId?: string) {
  const kept = results.filter((r) => r.status === 'kept').length
  const refused = results.flatMap((r) => (r.status === 'refused' ? [r] : []))
  if (kept) toast.success(`${plural(kept, 'document')} uploaded`, { toasterId })
  if (refused.length)
    toast.error(
      refused.length === 1
        ? `${refused[0].name} not uploaded`
        : `${refused.length} files not uploaded`,
      {
        description: refused
          .map((r) => (refused.length === 1 ? r.reason : `${r.name}: ${r.reason}`))
          .join(' '),
        toasterId,
      },
    )
  return kept
}
