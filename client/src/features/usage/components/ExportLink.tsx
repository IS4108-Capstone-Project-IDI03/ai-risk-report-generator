// The grey "Export CSV" pill (EV-04): a download link that looks like a secondary button.
// Used by every usage screen. A real link, not a button, so the browser saves the file.
import { Icon } from '../../../design-system'

/** Returns a download link styled as the secondary pill, with the download icon. */
export function ExportLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="uc-export" href={href} download>
      <Icon name="download" size={16} />
      {children}
    </a>
  )
}
