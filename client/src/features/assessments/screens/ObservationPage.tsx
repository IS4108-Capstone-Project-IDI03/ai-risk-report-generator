// One observation's own page (CP-22), in place of the old expanded row and
// Edit dialog: its location with arrows through every observation and its
// badge (From site walk). Then the words on the left: its categories, severity
// and location, its note, its recordings, what the AI suggests; and its
// pictures on the right: photos and handwritten pages (round 6). Rendered by
// screens/Observations.tsx.
import { useEffect, useRef } from 'react'
import { Icon } from '../../../design-system'
import { BackButton } from '../components/BackButton'
import { MediaPanel } from '../components/MediaPanel'
import { ObservationBadge } from '../components/ObservationBadge'
import { PathTitle } from '../components/PathTitle'
import { ObservationNote } from '../components/ObservationNote'
import { ObservationProposal, PhotoReading } from '../components/ObservationProposal'
import { ObservationTags } from '../components/ObservationTags'
import { PageEntry } from '../components/PageEntry'
import type { ViewedPhoto } from '../components/PhotoReferences'
import { RecordingItem } from '../components/RecordingItem'
import { RemovedMedia } from '../components/RemovedMedia'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useObservationSave } from '../useObservationSave'
import type { ObservationRowView } from '../useObservationsView'
import '../observation-page.css'

const SAVE_TEXT = { idle: '', saving: 'Saving…', saved: 'Saved', failed: '' }

export function ObservationPage({
  v,
  o,
  order,
  onView,
}: {
  v: AssessmentWorkflow
  o: ObservationRowView
  order: ObservationRowView[]
  onView: (photo: ViewedPhoto) => void
}) {
  const { status, save, whenSaved } = useObservationSave((change) =>
    v.saveObsChanges(o.key, change),
  )
  // Leaves once pending saves went through: if one failed, the page stays with
  // the reason, or the only copy of the edit would be lost.
  const leave = (to: string | null) => whenSaved(() => (to ? v.openObs(to, true) : v.closeObs()))
  const view = (photo: { name: string; url: string }) => onView({ ...photo, context: o.where })
  // a. Every observation in the assessment, in list order: the arrows step through them.
  const at = order.findIndex((x) => x.key === o.key)
  const previous = at > 0 ? order[at - 1] : undefined
  const next = at >= 0 ? order[at + 1] : undefined
  // Back names the screen it really returns to.
  const backLabel =
    v.obsFrom === 'photos'
      ? 'All Photos'
      : v.obsFrom === 'scans'
        ? 'All Handwritten Pages'
        : o.deleted
          ? 'Deleted observations'
          : 'Observations'
  const hasRecordings = o.recordings.length > 0 || o.hasAudio
  // Suggest categories lives in the category menu: the first reading, or a new one.
  const proposal = o.proposal
  const suggest = proposal
    ? proposal.status === 'unread'
      ? proposal.read
      : (proposal.readCategories ?? undefined)
    : undefined
  // Opened from the list or by the arrows, it starts at its top.
  const bar = useRef<HTMLDivElement>(null)
  // Braces matter: newer Chrome's scrollIntoView returns a promise, and an effect
  // that returns one crashes React when the page closes (blank screen).
  useEffect(() => {
    // The whole tab scrolls, so start it at the top; 'nearest' left Back under the tab bar.
    bar.current?.closest('.om-scroll')?.scrollTo?.({ top: 0 })
  }, [])
  return (
    <>
      {/* b. Back at the page's left, where every sub-screen has it; then where
          it is with its arrows, and how the last save went. */}
      <BackButton label={backLabel} onClick={() => leave(null)} />
      <div ref={bar} className="op-head">
        {o.fromSiteWalk && (
          <div className="op-badge">
            <ObservationBadge kind="walk" />
          </div>
        )}
        <div className="op-where">
          <button
            type="button"
            className="op-step"
            aria-label="Previous observation"
            disabled={!previous}
            onClick={() => previous && leave(previous.key)}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <PathTitle path={o.path} />
          <button
            type="button"
            className="op-step"
            aria-label="Next observation"
            disabled={!next}
            onClick={() => next && leave(next.key)}
          >
            <Icon name="chevron-right" size={20} />
          </button>
        </div>
        {/* Where this one sits among them; nothing when it is the only one. */}
        {order.length > 1 && at >= 0 && (
          <p className="op-which">{`${at + 1} of ${order.length}`}</p>
        )}
        <div className="op-actions">
          <span className="ob-saved" role="status">
            {SAVE_TEXT[status.state] && <span key={status.state}>{SAVE_TEXT[status.state]}</span>}
          </span>
          {!!o.addMedia && (
            <button type="button" className="ob-button ob-button--tinted" onClick={o.addMedia}>
              <Icon name="paperclip" size={16} />
              {'Add media'}
            </button>
          )}
          {o.canChange && (
            // The bin alone: everyone knows what it does (round 6).
            <button
              type="button"
              className="ob-button ob-button--danger ob-icon-button"
              aria-label="Delete observation"
              title="Delete"
              onClick={o.deleteObs}
            >
              <Icon name="trash-2" size={17} />
            </button>
          )}
          {o.canRestore && (
            <button type="button" className="ob-button ob-button--primary" onClick={o.restoreObs}>
              <Icon name="rotate-ccw" size={16} />
              {'Restore'}
            </button>
          )}
        </div>
      </div>
      {status.state === 'failed' && (
        <p className="ob-line ob-line--problem" role="alert" style={{ margin: '0 0 12px' }}>
          <Icon name="circle-alert" size={14} />
          <span>{'Not saved: ' + status.problem}</span>
        </p>
      )}
      {/* c. The words beside the pictures (stacked on a narrow screen). */}
      <div className="op-body">
        <div className="op-col">
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
          <ObservationTags
            o={o}
            locations={v.obsLocOptions}
            save={save}
            suggest={suggest}
            stamps={
              <>
                {!!o.deletedLabel && <p className="ob-stamp">{o.deletedLabel}</p>}
                {!!o.editedLabel && <p className="ob-stamp">{o.editedLabel}</p>}
              </>
            }
          />
          <ObservationNote key={o.key} note={o.detail ?? ''} canChange={o.canChange} save={save} />
          {hasRecordings && (
            <section className="ob-card ob-section" aria-label="Recordings">
              <h3 className="ob-section-head">
                <span>{'Recordings'}</span>
              </h3>
              {o.recordings.map((r) => (
                <RecordingItem key={r.id} r={r} />
              ))}
              {/* A sample observation's clip, played in this demo. */}
              {o.hasAudio && (
                <button
                  type="button"
                  className="ob-button ob-button--tinted ob-button--small"
                  onClick={v.playSampleAudio}
                >
                  <Icon name="play" size={14} />
                  {o.audioLabel}
                </button>
              )}
            </section>
          )}
          {/* What the AI suggests, in its own section under the recordings (round 6). */}
          {!!proposal && (
            <ObservationProposal proposal={proposal} save={save} busy={status.state === 'saving'} />
          )}
        </div>
        <div className="op-col">
          <MediaPanel
            photos={o.media.map((m) => ({
              key: m.id ?? m.name,
              name: m.name,
              url: m.url,
              remove: m.remove,
            }))}
            photoStamps={o.media
              .filter((m) => m.addedLabel)
              .map((m) => (
                <p key={m.name} className="ob-stamp">
                  {m.addedLabel}
                </p>
              ))}
            // Only when there is something to show: a reading, or photos to describe.
            photoReading={
              !!proposal &&
              proposal.status !== 'unread' &&
              (!!proposal.photos || o.media.length > 0) && (
                <PhotoReading proposal={proposal} save={save} busy={status.state === 'saving'} />
              )
            }
            pageCount={o.pages.length}
            pages={o.pages.map((p, index) => (
              <PageEntry
                key={p.id}
                page={p}
                first={index === 0}
                onView={() => view({ name: p.name, url: p.url })}
              />
            ))}
            onOpen={view}
          />
          {o.removedMedia.length > 0 && <RemovedMedia items={o.removedMedia} onOpen={view} />}
        </div>
      </div>
    </>
  )
}
