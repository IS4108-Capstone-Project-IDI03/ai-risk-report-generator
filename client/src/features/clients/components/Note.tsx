// A one-line explanation with an info icon, on the client page (CP-18).
// Called by SiteCard and ClientPage.
import { Icon } from '../../../design-system'

export function Note({ children }: { children: string }) {
  return (
    <p className="cl-note">
      <Icon name="info" size={16} color="var(--text-muted)" />
      <span>{children}</span>
    </p>
  )
}
