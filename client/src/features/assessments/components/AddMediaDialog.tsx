// Adds recordings and photos to an observation already saved (CP-08), from
// the Observations tab. Recorded or uploaded audio, and photos taken or
// chosen, wait in a Ready to add list until Add to observation saves them
// together. A failed save keeps the list and says why (AC18). Opened by
// screens/Observations.tsx; the save is addMedia in useAssessmentWorkflow.tsx.
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button, Callout, Dialog, IconRegistry } from '../../../design-system'
import { choosePhotos, microphoneProblem, record, unsupportedPhotos } from '../media'
import type { PhotoFile, VoiceClip } from '../types'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { AudioPickers, PhotoPickers, PhotoThumb, ReadyItem } from './MediaPickers'
import { useSave } from './useSave'

type Props = { v: AssessmentWorkflow; dialog: NonNullable<AssessmentWorkflow['obsDialog']> }

const heading = {
  margin: 0,
  fontSize: '13px',
  fontWeight: '600',
  color: 'var(--text-secondary)',
} as const

export function AddMediaDialog({ v, dialog }: Props) {
  const [clips, setClips] = useState<VoiceClip[]>([])
  const [photos, setPhotos] = useState<PhotoFile[]>([])
  const [recording, setRecording] = useState(false)
  // Why a microphone or a chosen file could not be used.
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const files = useRef(0)
  const recordings = useRef(dialog.nextRecording ?? 1)
  const { busy, problem: saveProblem, run } = useSave()
  // Closing mid-recording releases the microphone.
  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop()
    },
    [],
  )

  const toggleRecording = async () => {
    if (recorder.current) return recorder.current.stop()
    setProblem(null)
    try {
      recorder.current = await record((audio, length) => {
        recorder.current = null
        setRecording(false)
        const name = 'Recording ' + recordings.current++
        const clip = { id: ++files.current, name, length, audio, url: URL.createObjectURL(audio) }
        setClips((list) => [...list, clip])
      })
      setRecording(true)
    } catch (error: unknown) {
      setProblem({ title: 'Microphone unavailable', message: microphoneProblem(error) })
    }
  }
  const uploadAudio = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(event.target.files ?? [])]
    event.target.value = ''
    setProblem(null)
    setClips((list) => [
      ...list,
      ...chosen.map((file) => ({
        id: ++files.current,
        name: file.name,
        length: null,
        audio: file,
        url: URL.createObjectURL(file),
      })),
    ])
  }
  const addPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const { photos: chosen, refused } = choosePhotos([...(event.target.files ?? [])])
    event.target.value = ''
    setProblem(
      refused.length ? { title: 'Not a JPG or PNG', message: unsupportedPhotos(refused) } : null,
    )
    setPhotos((list) => [
      ...list,
      ...chosen.map((file) => {
        const id = ++files.current
        return { id, name: file.name || 'Photo ' + id, image: file, url: URL.createObjectURL(file) }
      }),
    ])
  }
  // Takes one off the list; clips and photos share one numbering.
  const drop = (file: VoiceClip | PhotoFile) => {
    URL.revokeObjectURL(file.url)
    setClips((list) => list.filter((c) => c.id !== file.id))
    setPhotos((list) => list.filter((p) => p.id !== file.id))
  }
  const cancel = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    for (const file of [...clips, ...photos]) URL.revokeObjectURL(file.url)
    v.closeObsDialog()
  }
  const listed = clips.length + photos.length

  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Add to observation"
      description={
        dialog.where +
        '. ' +
        (dialog.saved
          ? 'Each recording and photo is kept as captured, with your name and the time. Recordings are transcribed; photos are read only when you ask.'
          : 'No capture session, so these stay in this browser and are not uploaded.')
      }
      width={560}
      onClose={busy ? undefined : cancel}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={cancel}>
            {'Cancel'}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!listed || recording}
            onClick={() => run(() => v.addMedia(clips, photos))}
          >
            {'Add to observation'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!!saveProblem && (
          <div role="alert">
            <Callout tone="warning" title="Nothing added">
              {saveProblem} Everything is still listed; press Add to observation to try again.
            </Callout>
          </div>
        )}
        <section
          aria-label="Voice"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <p style={heading}>{'Voice'}</p>
          <AudioPickers
            recording={recording}
            onRecord={() => void toggleRecording()}
            onUpload={uploadAudio}
            busy={busy}
          />
          {recording && (
            <span role="status" style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              {'Recording… press Stop recording to add it to the list.'}
            </span>
          )}
        </section>
        <section
          aria-label="Photos"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <p style={heading}>{'Photos'}</p>
          <PhotoPickers onChange={addPhotos} busy={busy} />
        </section>
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title={problem.title}>
              {problem.message}
            </Callout>
          </div>
        )}
        {listed > 0 && (
          <section
            aria-label="Ready to add"
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            <p style={{ ...heading, display: 'flex', justifyContent: 'space-between' }}>
              <span>{'Ready to add'}</span>
              <span>{listed}</span>
            </p>
            {clips.map((clip) => (
              <ReadyItem
                key={clip.id}
                icon={clip.length ? 'mic' : 'file-audio'}
                title={clip.name}
                detail={clip.length}
              >
                <audio
                  controls
                  src={clip.url}
                  aria-label={'Play ' + clip.name}
                  style={{ height: '32px', flex: '1 1 180px', minWidth: 0 }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={IconRegistry.action.discard}
                  aria-label={'Remove ' + clip.name}
                  disabled={busy}
                  onClick={() => drop(clip)}
                />
              </ReadyItem>
            ))}
            {photos.map((photo) => (
              <ReadyItem key={photo.id} icon="image" title={photo.name}>
                <PhotoThumb url={photo.url} />
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={IconRegistry.action.discard}
                  aria-label={'Remove ' + photo.name}
                  disabled={busy}
                  onClick={() => drop(photo)}
                />
              </ReadyItem>
            ))}
          </section>
        )}
      </div>
    </Dialog>
  )
}
