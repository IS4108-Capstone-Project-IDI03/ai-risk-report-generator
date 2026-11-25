// Where client documents are added (CP-23 AC1, board 10): a drop zone with
// Upload files and Paste email text. Large on the empty start, with the
// accepted formats and a (?) on saving an email; slim ("Drop more files
// here") above the reading screen. Adding starts reading at once. Used by
// screens/NewAssessment.tsx and screens/ReadingDocuments.tsx.
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Button, Icon, Textarea } from '../../../design-system'
import { ACCEPT } from '../reading'
import { sampleEmail } from '../sampleEmail'
import { Tip } from '../../help/Tip'
import { onSignal } from '../../walkthrough/signals'

export function UploadArea({
  slim = false,
  onAdd,
}: {
  slim?: boolean
  onAdd: (files: File[], pastedText: string) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  // A file dropped just outside the zone would make the browser open it and
  // leave the screen, losing the form; while this shows, such drops do nothing.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])
  const add = (files: File[], pasted: string) => {
    setPasting(false)
    setText('')
    onAdd(files, pasted)
  }
  // F-12: "Use the sample email" in MarshBot's bubble adds the sample the way a chosen file is
  // added. Only the large start area listens: the slim one above the reading screen has no use for it.
  useEffect(() => {
    if (slim) return
    return onSignal('sample-email-wanted', () => onAdd([sampleEmail()], ''))
  }, [slim, onAdd])
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (e.dataTransfer.files.length) add([...e.dataTransfer.files], '')
  }
  const actions = (
    <span className="na-drop-actions">
      {/* The one main action on the large start is navy; the slim row above a reading keeps grey pills. */}
      <Button
        variant={slim ? 'pill' : 'primary'}
        pill
        iconLeft="upload"
        onClick={() => picker.current?.click()}
      >
        {'Upload files'}
      </Button>
      <Button
        variant="pill"
        iconLeft="clipboard-paste"
        aria-expanded={pasting}
        onClick={() => setPasting(!pasting)}
      >
        {'Paste email text'}
      </Button>
    </span>
  )
  return (
    <>
      <section
        className={'na-drop' + (slim ? ' na-drop--slim' : '') + (over ? ' is-over' : '')}
        aria-label="Add client documents"
        data-walk={slim ? undefined : 'new-assessment.upload'}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        // Only leaving the zone itself ends the tint, not moving over a child.
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
        }}
        onDrop={drop}
      >
        <span className="na-drop-icon">
          <Icon name="file-up" size={slim ? 18 : 24} />
        </span>
        {slim ? (
          <span className="na-drop-text na-muted">{'Drop more files here'}</span>
        ) : (
          <span className="na-drop-text">
            <strong>{'Add the client’s documents'}</strong>
            <span className="na-muted">
              {'PDF, Word, Outlook (.msg) or .eml files'}
              <Tip id="new-assessment.save-email">
                <ul>
                  <li>
                    <b>{'Outlook: '}</b>
                    {'open the email, then choose '}
                    <b>{'File → Save As'}</b>
                    {' and save it as Outlook Message Format (.msg).'}
                  </li>
                  <li>
                    <b>{'Gmail: '}</b>
                    {'open the email, then choose '}
                    <b className="na-nowrap">{'⋮ → Download message'}</b>
                    {' to save it as an .eml file.'}
                  </li>
                </ul>
              </Tip>
            </span>
          </span>
        )}
        {actions}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          aria-label="Upload files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) add(files, '')
          }}
        />
      </section>
      {pasting && (
        <div className="na-card na-paste">
          <Textarea
            label="Email text"
            rows={6}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="na-paste-actions">
            <Button variant="secondary" pill onClick={() => setPasting(false)}>
              {'Cancel'}
            </Button>
            <Button variant="primary" pill disabled={!text.trim()} onClick={() => add([], text)}>
              {'Read email text'}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
