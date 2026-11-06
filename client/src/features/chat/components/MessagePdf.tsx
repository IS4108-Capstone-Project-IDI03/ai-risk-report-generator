// The PDF a question carried, shown with it (CB-09). Used by components/UserMessage.tsx.
import { Icon } from '../../../design-system'

/** A chip with the file's name; amber with a warning when its text looked like instructions. */
export function MessagePdf({ pdfs }: { pdfs: { name: string; flagged: boolean }[] }) {
  if (!pdfs.length) return null
  return (
    <div className="message-photos">
      {pdfs.map((pdf) => (
        <span key={pdf.name} className="message-pdf" data-flagged={pdf.flagged || undefined}>
          <Icon name={pdf.flagged ? 'triangle-alert' : 'file-text'} size={16} />
          {pdf.name}
          {pdf.flagged && <small>Looks like instructions; read as plain text</small>}
        </span>
      ))}
    </div>
  )
}
