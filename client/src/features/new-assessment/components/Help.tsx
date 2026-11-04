// A (?) button that opens a short explanation (CP-23): visit types and how to
// save an email. The same look as capture's CaptureHelp.tsx. Used by
// VisitTypeControl.tsx and UploadArea.tsx.
import { useState, type ReactNode } from 'react'
import { Icon, Popover } from '../../../design-system'
import '../../assessments/capture.css'

export function Help({
  label,
  align = 'left',
  children,
}: {
  label: string
  align?: 'left' | 'right'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel={label}
      align={align}
      surfaceClassName="cap-help-menu"
      trigger={
        <button
          type="button"
          className="cap-help"
          aria-label={label}
          onClick={() => setOpen(!open)}
        >
          <Icon name="circle-help" size={18} />
        </button>
      }
    >
      <div className="na-help">{children}</div>
    </Popover>
  )
}
