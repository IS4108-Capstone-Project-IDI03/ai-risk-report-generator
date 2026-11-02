// The Recording screen of a site walk (CP-22 AC2–AC4): record in as many parts as
// you like, add typed notes between them, take photos without stopping, then Finish
// walk and name it (round 3). Opened from the Observations tab. Calls useWalk (keeps and sends) and
// useWalkRecorder (microphone, camera).
import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../../design-system'
import { CameraView } from '../components/CameraView'
import { HelpSheet } from '../components/HelpSheet'
import { NoteComposer } from '../components/NoteComposer'
import { PhotoStrip } from '../components/PhotoStrip'
import { RecordPanel } from '../components/RecordPanel'
import { WalkList } from '../components/WalkList'
import { BackButton } from '../../assessments/components/BackButton'
import { WalkNameDialog } from '../components/WalkNameDialog'
import { WalkToast, type WalkToastState } from '../components/WalkToast'
import { clock, mediaProblem } from '../recorder'
import { readDraft, writeDraft } from '../typedDraft'
import { usePhone } from '../usePhone'
import { useWalk } from '../useWalk'
import { useWalkRecorder } from '../useWalkRecorder'
import '../site-walk.css'
import '../walkList.css'
import '../recording.css'

// Records and saves the walk’s audio, notes and photos.
export function SiteWalkRecording({
  reference,
  onClose,
  back = 'Observations',
}: {
  reference: string
  onClose: () => void
  // The screen Back returns to: the Site walks list when it was opened from there.
  back?: string
}) {
  const w = useWalk(reference)
  const [text, setText] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  // Finish walk first asks for the walk's name (AC13).
  const [naming, setNaming] = useState(false)
  const phone = usePhone()
  const [toast, setToast] = useState<WalkToastState | null>(null)
  // Set only when a microphone attempt failed, so the alert never greets a fresh screen.
  const [micProblem, setMicProblem] = useState<string | null>(null)
  const { setProblem } = w

  const say = useCallback(
    (message: string) => setToast({ stamp: Date.now() + Math.random(), message }),
    [],
  )
  // At the cap the recording was stopped and kept for them: tell them, in words.
  const onCap = useCallback(
    () =>
      say('That recording reached 20 minutes and is saved. Start the next one when you’re ready.'),
    [say],
  )
  const rec = useWalkRecorder(w.claimSeq, w.addRecording, onCap)

  // Any start: the first recording, the next one, or after the track ended.
  const start = useCallback(async () => {
    setProblem(null)
    setMicProblem(null)
    try {
      await rec.start()
    } catch (e) {
      setMicProblem(mediaProblem(e))
    }
  }, [rec, setProblem])

  async function openCamera() {
    try {
      await rec.ensureStream()
      setCamera(true)
    } catch (e) {
      setMicProblem(mediaProblem(e))
    }
  }

  // Save recording: stops and keeps it. The toast doesn't wait for the upload, which
  // can take a while on a poor connection; the list shows where it has got to.
  function save() {
    void rec.stop()
    say('Recording saved')
  }

  // The unsent note is kept per walk on the device; it is dropped once sent.
  const walkId = w.walk?.id
  const note = text ?? (walkId ? readDraft(walkId) : null) ?? ''
  function type(value: string) {
    setText(value)
    if (walkId) writeDraft(walkId, value)
  }
  function clearDraft() {
    setText('')
    if (walkId) writeDraft(walkId, '')
  }
  async function addNote() {
    if (await w.addNote(note)) clearDraft()
  }
  useEffect(() => {
    if (w.finished && walkId) writeDraft(walkId, '')
  }, [w.finished, walkId])

  // Photos are stamped the moment they are taken, with where they sit in the walk (AC3).
  function keepPhoto(photo: Blob) {
    const { recordingSeq, offsetSec } = rec.stamp()
    w.addPhoto(photo, recordingSeq, offsetSec)
  }

  async function finish(name: string) {
    setBusy(true)
    // The recording running now is kept on the device first, so finish's flush sends it.
    await rec.stop()
    // An unsent note is sent as a note, numbered after that recording.
    await w.finish(name, note, clearDraft)
    setBusy(false)
    // Closed either way: a refusal shows its reason on the screen, and Finish walk asks again.
    setNaming(false)
  }

  if (w.finished)
    return (
      <div className="sw sw-recording">
        <div className="sw-finished" role="status">
          <span className="sw-finished-mark" aria-hidden="true">
            <Icon name="check" size={28} />
          </span>
          <h1>Walk finished</h1>
          <p className="sw-note">
            We’ll let you know when it’s ready. You can keep working in the meantime.
          </p>
          <button type="button" className="sw-button sw-button--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    )

  // Nothing can be recorded before the walk exists, or a clip would have nowhere to go.
  if (!w.walk)
    return (
      <div className="sw sw-recording">
        <div className="sw-finished" role={w.problem ? 'alert' : 'status'}>
          <p className="sw-note">{w.problem ?? 'Starting the site walk…'}</p>
          {w.problem && <BackButton label={back} onClick={onClose} />}
        </div>
      </div>
    )

  // The server refuses a walk with no recording and no note (site-walk.service.ts).
  const hasRecordings = w.items.some((i) => i.kind === 'recording')
  const canFinish =
    !busy && !rec.opening && (w.items.length > 0 || rec.phase !== 'idle' || note.trim().length > 0)
  return (
    <div className="sw sw-recording">
      <header className="sw-bar">
        <BackButton label={back} onClick={onClose} />
        <h1>Site Walk</h1>
        <button
          type="button"
          className="sw-button sw-icon-button"
          aria-label="How to record a site walk"
          onClick={() => setHelp(true)}
        >
          <Icon name="circle-help" size={20} />
        </button>
      </header>

      {/* Locked while finishing: a recording started now would run on unsent. */}
      <div className="sw-recording-body" inert={busy}>
        {w.problem && (
          <div className="sw-alert sw-alert--problem" role="alert">
            <p>{w.problem}</p>
          </div>
        )}
        {micProblem && (
          <div className="sw-alert sw-alert--problem" role="alert">
            <p>{micProblem}</p>
          </div>
        )}
        <div className="sw-rec-main">
          <RecordPanel
            phase={rec.phase}
            elapsed={rec.elapsed}
            notice={rec.notice}
            warning={rec.warning}
            hasRecordings={hasRecordings}
            onStart={() => void start()}
            onPause={rec.pause}
            onResume={rec.resume}
            onSave={save}
            onCamera={() => void openCamera()}
          />
          <PhotoStrip server={w.serverPhotos} local={w.localPhotos} />
          <NoteComposer value={note} onChange={type} onAdd={() => void addNote()} />
        </div>
        <WalkList items={w.items} onSaveNote={w.editNote} />
      </div>

      <footer className="sw-finish">
        <button
          type="button"
          className="sw-button sw-button--primary sw-button--wide"
          disabled={!canFinish}
          aria-describedby={!canFinish && !busy ? 'sw-finish-why' : undefined}
          onClick={() => setNaming(true)}
        >
          {busy ? 'Finishing…' : 'Finish walk'}
        </button>
        {!canFinish && !busy && (
          <p id="sw-finish-why" className="sw-note">
            Record or write something to finish.
          </p>
        )}
      </footer>

      {naming && (
        <WalkNameDialog
          title="Name this site walk"
          action="Finish walk"
          phone={phone}
          busy={busy}
          onSave={(name) => void finish(name)}
          onClose={() => setNaming(false)}
        />
      )}
      {toast && <WalkToast toast={toast} onDismiss={() => setToast(null)} />}
      {help && <HelpSheet onClose={() => setHelp(false)} />}
      {camera && (
        <CameraView
          stream={rec.stream}
          status={rec.phase === 'recording' ? clock(rec.elapsed) : null}
          onShot={keepPhoto}
          onClose={() => setCamera(false)}
        />
      )}
    </div>
  )
}
