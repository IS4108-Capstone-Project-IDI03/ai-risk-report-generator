// The error toast for an upload the gateway refused (CP-22 AC12-AC13). Called by
// useWalk's queue hook. Words come from uploadTypes.ts; no full stops.
import { toast } from '../../design-system'
import { GatewayError } from '../assessments/api'
import type { PendingUpload } from './pendingUploads'
import { wrongType } from './uploadTypes'

// Shows why a dropped upload was refused: too long, too large, or the wrong type.
export function refusalToast(item: PendingUpload, error: GatewayError) {
  if (error.detail.code === 'too_long')
    return toast.error('Recording is over 20 minutes', { description: 'Choose a shorter one' })
  if (error.status === 413)
    return toast.error('File is too large', { description: 'Choose a smaller one' })
  const { title, fix } = wrongType(item.name ?? '', item.kind)
  toast.error(title, { description: fix })
}
