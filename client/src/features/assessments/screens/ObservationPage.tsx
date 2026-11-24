// One observation's own page (CP-22, CP-24): a record header (Back, its category tile, where it is,
// the stepper through every observation, Add media and the bin), then the cards on the left (Note,
// Recordings, Photos, Handwritten pages, each only when it has something) and Details on the right.
// A category or severity the AI suggested shows its state in Details (components/ObservationDetails.tsx).
// Rendered by screens/Observations.tsx. Calls RecordHeader, RecordStepper and the cards.
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Icon,
  IconAction,
  RecordHeader,
  RecordStepper,
  useIsPhone,
} from '../../../design-system'
import { ObservationBadge } from '../components/ObservationBadge'
import { CategoryMark } from '../components/ObservationMarks'
import { ObservationDetails } from '../components/ObservationDetails'
import { ObservationKinds } from '../components/ObservationKinds'
import { ObservationNote } from '../components/ObservationNote'
import { PagesCard } from '../components/PagesCard'
import { PhotosCard } from '../components/PhotosCard'
import type { ViewedPhoto } from '../components/PhotoReferences'
import { RecordingsCard } from '../components/RecordingsCard'
import { RemovedMedia } from '../components/RemovedMedia'
import { locationParts } from '../locations'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useScrollToEvidence } from '../useScrollToEvidence'
import { useObservationSave } from '../useObservationSave'
import type { ObservationRowView } from '../useObservationsView'
import '../observation-page.css'

const SAVE_TEXT = { idle: '', saving: 'Saving…', saved: 'Saved', failed: '' }

// Which stepper arrow had focus when it was used. Stepping remounts the page (key={open.key} in
// screens/Observations.tsx), which drops focus; the new page reads this to put it back. Only a
// focused arrow is restored: focusing one nobody had focused would pop its tooltip open.
let steppedWith: 'previous' | 'next' | null = null

export function ObservationPage({
  v,
  o,
  order,
  onView,
  media,
}: {
  v: AssessmentWorkflow
  o: ObservationRowView
  order: ObservationRowView[]
  onView: (photo: ViewedPhoto) => void
  // A recording's or page's id to scroll to, from a MarshBot link (AS-06).
  media?: string
}) {
  const phone = useIsPhone()
  // The note as last left (the tag picker suggests from it once).
  const [blurred, setBlurred] = useState('')
  const { status, save, whenSaved } = useObservationSave((change) =>
    v.saveObsChanges(o.key, change),
  )
  // Leaves once pending saves went through: if one failed, the page stays with
  // the reason, or the only copy of the edit would be lost.
  const leave = (to: string | null, arrow?: 'previous' | 'next') =>
    whenSaved(() => {
      const focused = top.current?.querySelector('nav.rs')?.contains(document.activeElement)
      steppedWith = focused ? (arrow ?? null) : null
      if (to) v.openObs(to, true)
      else v.closeObs()
    })
  // A saved photo also carries how it last went to the AI (PV-04), and its
  // mark with a way to change it (CP-10).
  const view = (photo: { name: string; url: string }) => {
    const saved = o.media.find((m) => m.url === photo.url)
    onView({
      ...photo,
      context: o.where,
      redaction: saved?.redaction,
      region: saved?.region,
      mark: saved?.mark,
    })
  }
  // a. Every observation in the assessment, in list order: the stepper moves through them.
  const at = order.findIndex((x) => x.key === o.key)
  const previous = at > 0 ? order[at - 1] : undefined
  const next = at >= 0 ? order[at + 1] : undefined
  // Back names the screen it really returns to.
  const backLabel =
    v.obsViaOverview === o.key
      ? 'Overview'
      : v.obsFrom === 'photos'
        ? 'All Photos'
        : v.obsFrom === 'scans'
          ? 'All Handwritten Pages'
          : v.obsFrom === 'recordings'
            ? 'All Recordings'
            : o.deleted
              ? 'Deleted Observations'
              : 'Observations'
  const hasRecordings = o.recordings.length > 0 || o.hasAudio
  // Opened from the list or by the stepper, it starts at its top.
  const top = useRef<HTMLDivElement>(null)
  // Braces matter: newer Chrome's scrollIntoView returns a promise, and an effect
  // that returns one crashes React when the page closes (blank screen).
  useEffect(() => {
    // The whole tab scrolls, so start it at the top; 'nearest' left Back under the tab bar.
    top.current?.closest('.om-scroll')?.scrollTo?.({ top: 0 })
  }, [])
  // Stepped to from the other page: focus the same arrow again, or the other one when this
  // direction is now disabled (the last observation), so a keyboard user can keep stepping.
  useEffect(() => {
    if (!steppedWith) return
    const arrows = top.current?.querySelectorAll<HTMLButtonElement>('nav.rs button')
    const [first, second] = steppedWith === 'previous' ? [0, 1] : [1, 0]
    const wanted = arrows?.[first]?.disabled ? arrows?.[second] : arrows?.[first]
    wanted?.focus({ preventScroll: true })
    steppedWith = null
  }, [])
  // After the scroll to top, so a MarshBot link to a recording or page is not undone by it.
  useScrollToEvidence(media)

  // Where it is: the building and level over the place's name, as the title path shows them.
  const eyebrow = !o.path || o.path.bare ? '' : locationParts(o.path).slice(0, -1).join(' › ')
  const tile = (
    <span className="ob-cat-wrap">
      <CategoryMark cats={o.cats} />
      {o.fromSiteWalk && (
        <span className="ob-cat-flag">
          <ObservationBadge kind="walk" />
        </span>
      )}
    </span>
  )
  const stamps = [o.deletedLabel, o.editedLabel].filter((x): x is string => !!x)
  return (
    <div className="cpp" ref={top}>
      {/* b. Back, where it is, and at the right the stepper and its actions. */}
      <RecordHeader
        back={backLabel}
        onBack={() => leave(null)}
        tile={tile}
        eyebrow={eyebrow}
        title={o.path?.name ?? 'No location yet'}
        actions={
          <>
            <span className="ob-saved" role="status">
              {SAVE_TEXT[status.state] && <span key={status.state}>{SAVE_TEXT[status.state]}</span>}
            </span>
            {/* Where this one sits among them; nothing when it is the only one. */}
            {order.length > 1 && at >= 0 && (
              <RecordStepper
                at={at + 1}
                total={order.length}
                onPrevious={() => previous && leave(previous.key, 'previous')}
                onNext={() => next && leave(next.key, 'next')}
              />
            )}
            {!!o.addMedia && (
              <Button variant="pill" iconLeft="paperclip" onClick={o.addMedia}>
                {'Add media'}
              </Button>
            )}
            {o.canChange && (
              <IconAction
                icon="trash-2"
                label="Delete observation"
                tooltip="Delete observation"
                size="md"
                shaded
                style={{ color: 'var(--red-600)' }}
                onClick={o.deleteObs}
              />
            )}
            {o.canRestore && (
              <Button variant="create" iconLeft="rotate-ccw" onClick={o.restoreObs}>
                {'Restore'}
              </Button>
            )}
          </>
        }
      />
      {status.state === 'failed' && (
        <p className="ob-line ob-line--problem" role="alert" style={{ margin: '0 0 12px' }}>
          <Icon name="circle-alert" size={14} />
          <span>{'Not saved: ' + status.problem}</span>
        </p>
      )}
      {/* The checklist item it answers (CP-31), as worded then. */}
      {!!o.checklist && (
        <p className="ob-line">
          <Icon
            name={o.checklist.result === 'confirmed' ? 'circle-check' : 'equal-not'}
            size={14}
          />
          <span>
            {(o.checklist.result === 'confirmed' ? 'Confirms' : 'Differs from') +
              ' checklist: ' +
              o.checklist.text}
          </span>
        </p>
      )}
      {/* c. The cards: the left column never ends above Details (the Note card grows to it). */}
      <div className="cpp-body">
        <div className="cpp-main">
          <ObservationNote
            key={o.key}
            note={o.detail ?? ''}
            canChange={o.canChange}
            save={save}
            reference={v.liveReference ?? undefined}
            onLeave={setBlurred}
          />
          <ObservationKinds
            key={o.key}
            kinds={o.kinds}
            labels={o.labels}
            canChange={o.canChange}
            save={(change) => save(change)}
            reference={v.liveReference ?? undefined}
            text={o.detail || o.recordings[0]?.text || ''}
            blurred={blurred}
          />
          {hasRecordings && <RecordingsCard o={o} phone={phone} playSample={v.playSampleAudio} />}
          <PhotosCard
            tiles={o.media.map((m) => ({
              key: m.id ?? m.name,
              name: m.name,
              url: m.url,
              remove: m.remove,
              region: m.region,
            }))}
            stamps={o.media.map((m) => m.addedLabel).filter((x): x is string => !!x)}
            // The description of the photos, written without being asked (CP-24).
            description={o.photoDescription}
            save={save}
            busy={status.state === 'saving'}
            onOpen={view}
            onAdd={o.addMedia}
            retry={o.retryDescription}
          />
          {o.pages.length > 0 && <PagesCard pages={o.pages} onView={view} />}
          {o.removedMedia.length > 0 && <RemovedMedia items={o.removedMedia} onOpen={view} />}
        </div>
        <ObservationDetails
          o={o}
          locations={v.obsLocOptions}
          save={save}
          onConfirmed={(field) =>
            v.notify((field === 'category' ? 'Category' : 'Severity') + ' confirmed')
          }
          stamps={
            stamps.length > 0 && (
              <div className="cpp-stamps">
                {stamps.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )
          }
        />
      </div>
    </div>
  )
}
