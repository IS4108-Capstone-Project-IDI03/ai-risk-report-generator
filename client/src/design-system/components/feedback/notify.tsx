// Toast helper (CP-23, v2 section 7): Sonner behind our own wrapper, so callers never import it.
// Mount <Toaster /> once in the app shell (AssessmentApp.tsx); call `toast.*` anywhere.
import { Toaster as SonnerToaster, toast as sonner } from 'sonner'
import { Icon } from '../core/Icon'
import { SuccessIcon } from './SuccessIcon'

export type ToastAction = { label: string; onClick: () => void }
export type ToastOptions = {
  // A small button inside the toast: "Undo" after archive/delete, "View" after create.
  action?: ToastAction
  // Second, grey line (errors: the fix).
  description?: string
}

const wrap = (o: ToastOptions = {}) => ({
  description: o.description,
  action: o.action ? { label: o.action.label, onClick: o.action.onClick } : undefined,
})

export const toast = {
  /** Shows a green-tick toast that closes itself; returns its id. */
  success: (message: string, o?: ToastOptions) => sonner.success(message, wrap(o)),
  /** Shows a red-alert toast that stays until closed (errors don't auto-close); returns its id. */
  error: (title: string, o?: ToastOptions) =>
    sonner.error(title, { ...wrap(o), duration: Infinity }),
  /** Shows a loading toast that turns into success or error when the promise settles. */
  promise: <T,>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string },
  ) => sonner.promise(promise, messages),
  /** Closes one toast by id, or all of them. */
  dismiss: (id?: string | number) => sonner.dismiss(id),
}

/** Returns Sonner's toaster, styled by .ds-toast in styles.css (white card, radius 14, icon-only colour). */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      closeButton
      visibleToasts={3}
      icons={{
        success: <SuccessIcon />,
        error: <Icon name="circle-alert" size={18} color="var(--red-600)" />,
        loading: (
          <Icon
            name="loader-circle"
            size={18}
            color="var(--marsh-navy)"
            style={{ animation: 'dsSpin 0.9s linear infinite' }}
          />
        ),
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'ds-toast',
          title: 'ds-toast-title',
          description: 'ds-toast-desc',
          actionButton: 'ds-toast-action',
          closeButton: 'ds-toast-close',
          icon: 'ds-toast-icon',
        },
      }}
    />
  )
}
