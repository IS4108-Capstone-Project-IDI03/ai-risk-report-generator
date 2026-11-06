// The PDF button in the chat box and the chips under it (CB-09): attach up to 3 PDFs (10 MB and 20
// pages each) to a chat and ask about them. Each file is read at once, so a file that cannot be
// used is refused before the question is written. Drawn inside AgentInterface
// (screens/KnowledgeAssistant.tsx).
import { useThread } from '@openuidev/react-headless'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IconButton } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { removeChatPdf, uploadChatPdf } from '../api'
import {
  addPendingPdf,
  removePendingPdf,
  usePendingPdfs,
  useSentPdfIds,
  type PendingPdf,
} from '../photoStore'
import { asProblem, type Problem } from '../speech'
import { useComposerHosts } from './useComposerHosts'

const MAX_BYTES = 10 * 1024 * 1024
// Must match MAX_PDFS_PER_CHAT in server/src/services/chat-pdf.service.ts.
const MAX_PDFS = 3

/** PDF button and the chips for the files being attached. */
export function PdfAttach() {
  const pending = usePendingPdfs()
  const sentIds = useSentPdfIds()
  // The PDFs a chat reopened from storage already holds, from the questions that carried them.
  const savedIds = useThread((s) =>
    s.messages
      .flatMap((m) => (m as { pdfs?: { id: string }[] }).pdfs ?? [])
      .map((p) => p.id)
      .join(','),
  )
  const { card, below } = useComposerHosts()
  const [note, setNote] = useState<Problem | null>(null)
  // Files still being read; they count toward the limit.
  const [busy, setBusy] = useState(0)
  const picker = useRef<HTMLInputElement>(null)
  // A PDF counts once, whether it came from this page or from storage.
  const inChat = new Set([...sentIds.split(','), ...savedIds.split(',')].filter(Boolean)).size
  const used = inChat + pending.length + busy
  const full = used >= MAX_PDFS

  const add = async (files: File[]) => {
    setNote(null)
    let count = used
    for (const file of files) {
      const refusal = refuse(file, count)
      if (refusal) {
        setNote(refusal)
        continue
      }
      count += 1
      setBusy((n) => n + 1)
      try {
        addPendingPdf(await uploadChatPdf(file))
      } catch (error) {
        count -= 1
        setNote(
          asProblem(error instanceof GatewayError ? error.message : 'Could not add that PDF.'),
        )
      } finally {
        setBusy((n) => n - 1)
      }
    }
  }
  const remove = (pdf: PendingPdf) => {
    removePendingPdf(pdf.id)
    void removeChatPdf(pdf.id).catch(() => {})
  }

  const button = (
    <div className="pdf-attach">
      <IconButton
        icon="file-plus"
        label="Attach a PDF"
        disabledReason={
          full
            ? { title: 'Up to 3 PDFs per chat', text: 'Remove one, or start a new chat.' }
            : undefined
        }
        onClick={() => picker.current?.click()}
      />
      <input
        ref={picker}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(e) => {
          void add([...(e.target.files ?? [])])
          // So choosing the same file again still fires a change.
          e.target.value = ''
        }}
      />
    </div>
  )
  const tray = (pending.length > 0 || busy > 0 || note) && (
    <div className="photo-tray">
      {pending.map((pdf) => (
        <div key={pdf.id} className="pdf-tray__file">
          <div className="photo-tray__item pdf-chip">
            <Icon name="file-text" size={20} />
            <span>
              <strong>{pdf.name}</strong>
              <small>
                {pdf.pages} {pdf.pages === 1 ? 'page' : 'pages'} read
                {pdf.skipped.length > 0 &&
                  ` · picture-only pages skipped: ${pdf.skipped.join(', ')}`}
              </small>
            </span>
            <IconButton
              icon="x"
              label={`Remove PDF ${pdf.name}`}
              tooltip="Remove PDF"
              onClick={() => remove(pdf)}
            />
          </div>
          {pdf.flagged && (
            <p className="pdf-warning" role="status">
              <Icon name="triangle-alert" size={16} />
              <strong>Looks like instructions</strong>
              <span>{pdf.name} tells the assistant what to do. It is read as plain text only.</span>
            </p>
          )}
        </div>
      ))}
      {busy > 0 && (
        <p className="voice-input__state" role="status">
          Reading PDF…
        </p>
      )}
      {note && (
        <p className="voice-input__note" role="alert">
          <Icon name="circle-alert" size={16} />
          <strong>{note.problem}</strong>
          {note.fix && <span>{note.fix}</span>}
        </p>
      )}
    </div>
  )
  return (
    <>
      {card && createPortal(button, card)}
      {below && tray && createPortal(tray, below)}
    </>
  )
}

// Why a file cannot be added, in design system v2's wording (short problem, then the fix); null if it can.
function refuse(file: File, already: number): Problem | null {
  if (already >= MAX_PDFS)
    return { problem: 'Up to 3 PDFs per chat', fix: 'Remove one, or start a new chat.' }
  if (file.type !== 'application/pdf')
    return { problem: 'Only PDF files', fix: `${file.name} was not added.` }
  if (file.size > MAX_BYTES) return { problem: 'Over 10 MB', fix: `${file.name} was not added.` }
  return null
}
