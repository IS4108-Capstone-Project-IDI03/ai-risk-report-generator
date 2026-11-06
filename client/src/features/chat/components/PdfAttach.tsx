// The PDF button in the chat box and its chip under it (CB-09): attach one PDF (10 MB, 20 pages) to
// a chat and ask about it. The file is read at once, so a file that cannot be used is refused
// before the question is written. Drawn inside AgentInterface (screens/KnowledgeAssistant.tsx).
import { useThread } from '@openuidev/react-headless'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IconButton } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { removeChatPdf, uploadChatPdf } from '../api'
import { setPendingPdf, useAnySentPdf, usePendingPdf } from '../photoStore'
import { asProblem, type Problem } from '../speech'
import { useComposerHosts } from './useComposerHosts'

const MAX_BYTES = 10 * 1024 * 1024

/** PDF button and the chip for the file being attached. */
export function PdfAttach() {
  const pdf = usePendingPdf()
  const sentHere = useAnySentPdf()
  // A chat reopened from storage holds a PDF when one of its questions carried it.
  const saved = useThread((s) => s.messages.some((m) => !!(m as { pdfs?: unknown[] }).pdfs?.length))
  const { card, below } = useComposerHosts()
  const [note, setNote] = useState<Problem | null>(null)
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const hasPdf = sentHere || saved

  const add = async (file: File | undefined) => {
    setNote(null)
    if (!file) return
    if (file.type !== 'application/pdf')
      return setNote({ problem: 'Only PDF files', fix: `${file.name} was not added.` })
    if (file.size > MAX_BYTES)
      return setNote({ problem: 'Over 10 MB', fix: `${file.name} was not added.` })
    setBusy(true)
    try {
      setPendingPdf(await uploadChatPdf(file))
    } catch (error) {
      setNote(asProblem(error instanceof GatewayError ? error.message : 'Could not add that PDF.'))
    } finally {
      setBusy(false)
    }
  }
  const remove = () => {
    if (!pdf) return
    setPendingPdf(null)
    void removeChatPdf(pdf.id).catch(() => {})
  }

  const button = (
    <div className="pdf-attach">
      <IconButton
        icon="file-plus"
        label="Attach a PDF"
        disabled={!!pdf || busy}
        disabledReason={
          hasPdf
            ? { title: 'One PDF per chat', text: 'Start a new chat to use another PDF.' }
            : undefined
        }
        onClick={() => picker.current?.click()}
      />
      <input
        ref={picker}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          void add(e.target.files?.[0])
          // So choosing the same file again still fires a change.
          e.target.value = ''
        }}
      />
    </div>
  )
  const tray = (pdf || busy || note) && (
    <div className="photo-tray">
      {pdf && (
        <div className="photo-tray__item pdf-chip">
          <Icon name="file-text" size={20} />
          <span>
            <strong>{pdf.name}</strong>
            <small>
              {pdf.pages} {pdf.pages === 1 ? 'page' : 'pages'} read
              {pdf.skipped.length > 0 && ` · picture-only pages skipped: ${pdf.skipped.join(', ')}`}
            </small>
          </span>
          <IconButton
            icon="x"
            label={`Remove PDF ${pdf.name}`}
            tooltip="Remove PDF"
            onClick={remove}
          />
        </div>
      )}
      {pdf?.flagged && (
        <p className="pdf-warning" role="status">
          <Icon name="triangle-alert" size={16} />
          <strong>Looks like instructions</strong>
          <span>This file tells the assistant what to do. It is read as plain text only.</span>
        </p>
      )}
      {busy && (
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
