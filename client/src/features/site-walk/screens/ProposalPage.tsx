// One proposed observation on its own page (CP-22 round 1, round 5, round 6): the
// Observations tab's observation page (assessments/screens/ObservationPage.tsx)
// with its own parts. Back, its place with ‹ › arrows, the save state and
// Delete (Restore when deleted), badged "Proposed observation"; its tags
// (ObservationTags), note (ObservationNote) and recordings on the left, its
// photos and handwritten pages on the right (MediaPanel). Edits
// go straight to the proposal (autosaved by useProposal.ts). Rendered by
// screens/Review.tsx, in place of the proposal's header and table.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { BackButton } from '../../assessments/components/BackButton'
import { MediaPanel } from '../../assessments/components/MediaPanel'
import { ObservationBadge } from '../../assessments/components/ObservationBadge'
import { ObservationNote } from '../../assessments/components/ObservationNote'
import { ObservationTags, type TagsView } from '../../assessments/components/ObservationTags'
import { PathTitle } from '../../assessments/components/PathTitle'
import { PhotoGrid } from '../../assessments/components/PhotoGrid'
import type { ViewedPhoto } from '../../assessments/components/PhotoReferences'
import { locationLabel } from '../../assessments/locations'
import type { ObservationChange } from '../../assessments/useAssessmentWorkflow'
import type { Cope, Proposal, ProposedObservation, Severity, SiteWalk } from '../api'
import { pathOf, placeOptions } from '../options'
import { ALL, sectionsAt } from '../proposal'
import type { SaveState } from '../useProposal'
import '../../assessments/observation-page.css'

type Patch = Partial<
  Pick<ProposedObservation, 'note' | 'copeDimension' | 'severity' | 'locationRef'>
>

// As on the tab's page: nothing until an edit here, then how its save went.
const SAVE_TEXT: Record<SaveState, string> = {
  unsaved: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: '',
}
// Create all transcribes a failed clip again on the observation.
const NOT_YET = 'Not transcribed yet. It is transcribed again when you create all.'

export function ProposalPage({
  proposal,
  observation: o,
  walk,
  deleted,
  back,
  saveState,
  problem,
  onChange,
  onDelete,
  onRestore,
  onStep,
  onView,
}: {
  proposal: Proposal
  observation: ProposedObservation
  walk: SiteWalk
  // A deleted one is read only, with Restore.
  deleted: boolean
  back: { label: string; onClick: () => void }
  saveState: SaveState
  problem: string | null
  onChange: (patch: Patch) => void
  onDelete: () => void
  onRestore: () => void
  onStep: (ref: string) => void
  onView: (photo: ViewedPhoto) => void
}) {
  const [edited, setEdited] = useState(false)
  // a. Its list's order (No location yet first, then each location; the
  // deleted list newest first): the arrows step through all of them.
  const order = deleted
    ? (proposal.removed ?? [])
    : sectionsAt(proposal, ALL).flatMap((section) => section.items)
  const at = order.findIndex((x) => x.ref === o.ref)
  const previous = at > 0 ? order[at - 1] : undefined
  const next = order[at + 1]
  const place = proposal.locations.find((l) => l.ref === o.locationRef)
  const where = place ? locationLabel(pathOf(place)) : 'No location yet'

  // b. The tab's tags and note, filled from the proposed observation; their
  // saves become edits of the proposal.
  const tags: TagsView = {
    canChange: !deleted,
    cats: o.copeDimension ? [o.copeDimension] : [],
    catLabel: o.copeDimension ?? 'Choose a category',
    sev: o.severity ?? '',
    sevLabel: o.severity
      ? o.severity.charAt(0).toUpperCase() + o.severity.slice(1)
      : 'Choose a severity',
    locationId: o.locationRef ?? undefined,
    where: place ? where : 'Choose a location',
  }
  const save = async (change: ObservationChange) => {
    setEdited(true)
    onChange({
      ...(change.cats && { copeDimension: (change.cats[0] ?? null) as Cope | null }),
      ...(change.sev && { severity: change.sev as Severity }),
      ...(change.locationId !== undefined && { locationRef: change.locationId || null }),
      ...(change.note !== undefined && { note: change.note }),
    })
    return true
  }

  // c. Its evidence: the walk's clip and photos, then what was added by hand.
  const recording = walk.recordings.find((r) => r.seq === o.recordingSeq)
  // #t=start,end plays just this part of the walk's recording.
  const clip =
    recording?.audioUrl && o.start !== null && o.end !== null
      ? `${recording.audioUrl}#t=${o.start},${o.end}`
      : null
  const added = (walk.media ?? []).filter((m) => o.mediaIds?.includes(m.id))
  const voices = added.filter((m) => m.kind === 'voice')
  const pages = added.filter((m) => m.kind === 'page')
  const photos = [
    ...walk.photos.filter((p) => o.photoIds.includes(p.id)).map((p) => ({ id: p.id, url: p.url })),
    ...added.filter((m) => m.kind === 'photo'),
  ]
  const view = (photo: { name: string; url: string }) => onView({ ...photo, context: where })

  // Opened from the list or by the arrows, it starts at its top.
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bar.current?.closest('.om-scroll')?.scrollTo?.({ top: 0 })
  }, [])
  return (
    <>
      {/* d. Back at the page's left; then where it is with its arrows, and how
          the last save went. */}
      <BackButton label={back.label} onClick={back.onClick} />
      <div ref={bar} className="op-head">
        {/* Marked as a proposal's, so it never reads as a saved observation (round 6). */}
        <div className="op-badge">
          <ObservationBadge kind="proposal" label="Proposed observation" />
        </div>
        <div className="op-where">
          <button
            type="button"
            className="op-step"
            aria-label="Previous observation"
            disabled={!previous}
            onClick={() => previous && onStep(previous.ref)}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <PathTitle path={place ? pathOf(place) : null} />
          <button
            type="button"
            className="op-step"
            aria-label="Next observation"
            disabled={!next}
            onClick={() => next && onStep(next.ref)}
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
            {edited && SAVE_TEXT[saveState] && <span key={saveState}>{SAVE_TEXT[saveState]}</span>}
          </span>
          {deleted ? (
            <button type="button" className="ob-button ob-button--primary" onClick={onRestore}>
              <Icon name="rotate-ccw" size={16} />
              Restore
            </button>
          ) : (
            // The bin alone: everyone knows what it does (round 6).
            <button
              type="button"
              className="ob-button ob-button--danger ob-icon-button"
              aria-label="Delete observation"
              title="Delete"
              onClick={onDelete}
            >
              <Icon name="trash-2" size={17} />
            </button>
          )}
        </div>
      </div>
      {deleted && (
        <p className="ob-line" style={{ margin: '0 0 12px' }}>
          <Icon name="info" size={14} />
          <span>Deleted. Create all skips it unless you restore it.</span>
        </p>
      )}
      {saveState === 'failed' && !!problem && (
        <p className="ob-line ob-line--problem" role="alert" style={{ margin: '0 0 12px' }}>
          <Icon name="circle-alert" size={14} />
          <span>{'Not saved: ' + problem}</span>
        </p>
      )}
      {/* e. The words (tags, note, recordings) beside the pictures (photos,
          pages), as on the tab's page (stacked on a narrow screen). */}
      <div className="op-body">
        <div className="op-col">
          <ObservationTags
            o={tags}
            proposed
            locations={placeOptions(proposal.locations, (l) => l.ref)}
            save={save}
            stamps={null}
          />
          <ObservationNote key={o.ref} live note={o.note} canChange={!deleted} save={save} />
          {(clip || voices.length > 0) && (
            <section className="ob-card ob-section" aria-label="Recordings">
              <h3 className="ob-section-head">
                <span>Recordings</span>
              </h3>
              {clip && (
                <section className="ob-item" aria-label="Site walk recording">
                  <div className="ob-item-head">
                    <Icon name="mic" size={16} color="var(--ink-600)" />
                    <span>Site walk recording</span>
                  </div>
                  <audio
                    className="ob-audio"
                    controls
                    preload="none"
                    src={clip}
                    aria-label="Play site walk recording"
                  />
                </section>
              )}
              {voices.map((v, i) => (
                <section key={v.id} className="ob-item" aria-label={`Voice ${i + 1}`}>
                  <div className="ob-item-head">
                    <Icon name="mic" size={16} color="var(--ink-600)" />
                    <span>{`Voice ${i + 1}`}</span>
                  </div>
                  <p className="ob-transcript">
                    {v.transcript ?? (v.transcription === 'failed' ? NOT_YET : 'Transcribing…')}
                  </p>
                  <audio
                    className="ob-audio"
                    controls
                    preload="none"
                    src={v.url}
                    aria-label={`Play voice ${i + 1}`}
                  />
                </section>
              ))}
            </section>
          )}
        </div>
        <div className="op-col">
          {/* Pages are read once Create all makes the observation, so tiles only. */}
          <MediaPanel
            photos={photos.map((p, i) => ({ key: p.id, name: `Photo ${i + 1}`, url: p.url }))}
            pageCount={pages.length}
            pages={
              <PhotoGrid
                label="Handwritten pages of this observation"
                tiles={pages.map((m, i) => ({ key: m.id, name: `Page ${i + 1}`, url: m.url }))}
                onOpen={view}
              />
            }
            onOpen={view}
          />
        </div>
      </div>
    </>
  )
}
