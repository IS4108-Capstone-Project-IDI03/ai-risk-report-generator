// One proposed observation on its own page (CP-22 round 1, round 5, round 6, v2 in CP-24): the
// saved observation's page (assessments/screens/ObservationPage.tsx) with a proposal's parts. A
// record header (Back, its tile, "Proposed observation" over where it is, the save state, the stepper
// and the bin), then the note, tags and evidence cards on the left and Details on the right.
// Edits go straight to the proposal (autosaved by useProposal.ts). Rendered by screens/Review.tsx,
// in place of the proposal's header and table. Calls ProposalPageHeader, ProposalDetails,
// ProposalEvidence.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { ObservationKinds } from '../../assessments/components/ObservationKinds'
import { ObservationNote } from '../../assessments/components/ObservationNote'
import type { ViewedPhoto } from '../../assessments/components/PhotoReferences'
import { locationLabel } from '../../assessments/locations'
import type { ObservationChange } from '../../assessments/useAssessmentWorkflow'
import type { SiteLocation } from '../../assessments/api'
import type { Proposal, ProposedLocation, ProposedObservation, SiteWalk } from '../api'
import { pathOf, placeOptions } from '../options'
import { ProposalDetails } from '../components/ProposalDetails'
import { ProposalEvidence } from '../components/ProposalEvidence'
import { ProposalPageHeader } from '../components/ProposalPageHeader'
import { ALL, sectionsAt, type ObservationPatch } from '../proposal'
import type { SaveState } from '../useProposal'
import '../../assessments/observation-page.css'

// Marks a picker value as one of the assessment's own locations, not a proposal ref.
const EXISTING = 'existing:'

// As on the tab's page: nothing until an edit here, then how its save went.
const SAVE_TEXT: Record<SaveState, string> = {
  unsaved: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: '',
}

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
  readOnly = false,
  reference,
  others = [],
  onPlace,
}: {
  proposal: Proposal
  observation: ProposedObservation
  walk: SiteWalk
  // A deleted one is read only, with Restore.
  deleted: boolean
  back: { label: string; onClick: () => void }
  saveState: SaveState
  problem: string | null
  onChange: (patch: ObservationPatch) => void
  onDelete: () => void
  onRestore: () => void
  onStep: (ref: string) => void
  onView: (photo: ViewedPhoto) => void
  // Someone else's proposal (RV-11 AC2): every word shows, nothing can be changed.
  readOnly?: boolean
  // The walk's assessment, so the note can be dictated into (CP-27).
  reference?: string
  // The assessment's locations the proposal doesn't use yet, offered beside its own.
  others?: SiteLocation[]
  // Puts the observation at one of `others`.
  onPlace?: (location: SiteLocation) => void
}) {
  const [edited, setEdited] = useState(false)
  // The note as last left (the tag picker suggests from it once).
  const [blurred, setBlurred] = useState('')
  // a. Its list's order (No location yet first, then each location; the
  // deleted list newest first): the arrows step through all of them.
  const listed = deleted
    ? (proposal.removed ?? [])
    : sectionsAt(proposal, ALL).flatMap((section) => section.items)
  // Kept as it was when the page opened: choosing a place moves the observation in the list,
  // and without this Next would then step on from its new spot, skipping the rest still to place.
  const [opened] = useState(() => listed.map((x) => x.ref))
  const order = opened.flatMap((ref) => listed.filter((x) => x.ref === ref))
  const at = order.findIndex((x) => x.ref === o.ref)
  const previous = at > 0 ? order[at - 1] : undefined
  const next = order[at + 1]
  const place = proposal.locations.find((l) => l.ref === o.locationRef)
  const where = place ? locationLabel(pathOf(place)) : 'No location yet'

  // b. Every edit goes straight to the proposal; the note's save is one of them.
  const edit = (patch: ObservationPatch) => {
    setEdited(true)
    const other = others.find((l) => EXISTING + l.id === patch.locationRef)
    if (other && onPlace) onPlace(other)
    else onChange(patch)
  }
  const save = async (change: ObservationChange) => {
    if (change.note !== undefined) edit({ note: change.note })
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
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    top.current?.closest('.om-scroll')?.scrollTo?.({ top: 0 })
  }, [])
  const canChange = !deleted && !readOnly
  return (
    <div className="cpp" ref={top}>
      {/* d. Back, where it is, and at the right the save state, the stepper and the bin. */}
      <ProposalPageHeader
        back={back}
        observation={o}
        title={place ? (pathOf(place).name ?? where) : 'No location yet'}
        saveText={edited ? SAVE_TEXT[saveState] : ''}
        at={at + 1}
        total={order.length}
        onStep={(to) => {
          const target = to < 0 ? previous : next
          if (target) onStep(target.ref)
        }}
        deleted={deleted}
        readOnly={readOnly}
        onDelete={onDelete}
        onRestore={onRestore}
      />
      {deleted && (
        <p className="ob-line">
          <Icon name="info" size={14} />
          <span>
            {readOnly ? 'Deleted.' : 'Deleted. Create all skips it unless you restore it.'}
          </span>
        </p>
      )}
      {saveState === 'failed' && !!problem && (
        <p className="ob-line ob-line--problem" role="alert">
          <Icon name="circle-alert" size={14} />
          <span>{'Not saved: ' + problem}</span>
        </p>
      )}
      {/* e. The words (note, tags, recordings) and pictures on the left, Details on the right
          (below on a narrow screen), as on the tab's page. */}
      <div className="cpp-body">
        <div className="cpp-main">
          <ObservationNote
            key={'note-' + o.ref}
            live
            reference={reference}
            note={o.note}
            canChange={canChange}
            save={save}
            onLeave={setBlurred}
          />
          <ObservationKinds
            key={'tags-' + o.ref}
            kinds={o.kinds}
            canChange={canChange}
            withLabels={false}
            save={async ({ kinds }) => {
              edit({ kinds })
              return true
            }}
            reference={reference}
            text={o.note}
            blurred={blurred}
          />
          <ProposalEvidence
            clip={clip}
            clipLength={clip ? (o.end ?? 0) - (o.start ?? 0) : null}
            voices={voices}
            photos={photos.map((p, i) => ({ key: p.id, name: `Photo ${i + 1}`, url: p.url }))}
            pages={pages.map((m, i) => ({ key: m.id, name: `Page ${i + 1}`, url: m.url }))}
            onOpen={view}
          />
        </div>
        <ProposalDetails
          o={o}
          locations={placeOptions<ProposedLocation | SiteLocation>(
            [...proposal.locations, ...others],
            (l) => ('ref' in l ? l.ref : EXISTING + l.id),
          )}
          where={place ? where : null}
          canChange={canChange}
          onChange={edit}
        />
      </div>
    </div>
  )
}
