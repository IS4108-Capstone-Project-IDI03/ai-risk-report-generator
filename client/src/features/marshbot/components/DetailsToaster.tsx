// Where toasts raised from the Details panel appear (AS-06): a toaster inside the panel's own
// dialog. The panel is a modal <dialog> in the top layer, so the app's toaster (outside it) would
// sit under the panel and its Undo could not be clicked. Called by DetailsPanel.tsx.
import { Toaster } from '../../../design-system'
import { DETAILS_TOASTER } from './detailsToast'
import './details.css'

/** Returns the toaster for toasts sent with `toasterId: DETAILS_TOASTER`, centred at the panel's foot. */
export function DetailsToaster() {
  return <Toaster id={DETAILS_TOASTER} className="mb-details-toaster" />
}
