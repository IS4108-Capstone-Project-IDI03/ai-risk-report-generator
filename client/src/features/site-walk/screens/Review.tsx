// The Review screen of a site walk proposal (CP-22 AC7, AC9, AC10; round 1,
// round 5): the Observations tab's own layout. A navigator of the proposal's
// locations on the left with the tab's foot, the selected one's observations on
// the right with the tab's filters, a tap opening one as the tab's observation
// page in place. The foot opens the proposal's own photos, pages and deleted
// observations. Every edit is autosaved; Create all adds everything once.
// Opened from the Observations tab's walk list or the bell; state lives in
// useProposal, the edits in proposal.ts.
import { useEffect, useState } from 'react'
import { ObservationBadge } from '../../assessments/components/ObservationBadge'
import { ScreenHeader } from '../../assessments/components/ScreenHeader'
import { setLeaveGuard } from '../../assessments/leaveGuard'
import { PhotoDialog, type ViewedPhoto } from '../../assessments/components/PhotoReferences'
import { useFitPane } from '../../assessments/useFitPane'
import { ExistingLocationDialog } from '../components/ExistingLocationDialog'
import { LocationForm } from '../components/LocationForm'
import { ProposalHeader } from '../components/ProposalHeader'
import { ProposalNavigator } from '../components/ProposalNavigator'
import { DeletedProposalTable, ProposalTable } from '../components/ProposalTables'
import { RemoveLocationDialog } from '../components/RemoveLocationDialog'
import { UndoToast } from '../components/UndoToast'
import { WalkNameDialog } from '../components/WalkNameDialog'
import { WalkStatusMessage } from '../components/WalkStatusMessage'
import type { ProposedObservation } from '../api'
import { walkName } from '../walkLabels'
import * as edit from '../proposal'
import { siteWalkReview } from '../openReview'
import { openProposalCapture } from '../proposalCapture'
import { useProposal } from '../useProposal'
import { usePhone } from '../usePhone'
import { ProposalMedia } from './ProposalMedia'
import { ProposalPage } from './ProposalPage'
import '../../assessments/observations.css'
import '../review.css'

type Form = { kind: 'add' } | { kind: 'rename'; ref: string } | null
// The table, or one of the foot's screens; a page opens over whichever it was.
type Screen = 'list' | 'deleted' | 'photos' | 'pages'
const SCREEN_TITLE: Record<Exclude<Screen, 'list'>, string> = {
  deleted: 'Deleted Observations',
  photos: 'All Photos',
  pages: 'All Handwritten Pages',
}

// Reviews and autosaves the proposal before Create all.
export function SiteWalkReview({
  reference,
  walkId,
  opened,
  onOpen,
  backTo = 'Site walk proposals',
  onClose,
  onCreated,
  notify,
}: {
  reference: string
  walkId: string
  // The observation to open on (from the URL), and who hears each one opened.
  opened?: string
  onOpen?: (ref: string | null) => void
  // Where Back leaves to: the screen the review was opened from.
  backTo?: string
  onClose: () => void
  // Gets the toast words naming what was created.
  onCreated: (message: string) => void
  // Shows a toast in the workspace, after each action here (round 4).
  notify: (message: string) => void
}) {
  const r = useProposal(reference, walkId)
  const phone = usePhone()
  // The workspace tabs and sidebar stay on screen (the review sits in the
  // Observations tab), so they save first too, and stay if that fails.
  const { save } = r
  useEffect(
    () =>
      setLeaveGuard((proceed) => {
        void save().then((saved) => saved && proceed())
        return true
      }),
    [save],
  )
  const [picked, setPicked] = useState<string | null>(null)
  // Opens on the observation the Add manually screen just added, if it handed
  // one back, else the one the URL names.
  const [openRef, setOpenRef] = useState<string | null>(() => {
    const ref = siteWalkReview.observationRef
    siteWalkReview.observationRef = null
    return ref ?? opened ?? null
  })
  useEffect(() => onOpen?.(openRef), [onOpen, openRef])
  const [screen, setScreen] = useState<Screen>('list')
  const [filters, setFilters] = useState(edit.NO_PROPOSAL_FILTERS)
  const [form, setForm] = useState<Form>(null)
  // Renaming the proposal (AC13): open, and why the last try failed.
  const [naming, setNaming] = useState<{ busy: boolean; problem: string | null } | null>(null)
  // The navigator and table stay put; only the table scrolls (round 3).
  const pane = useFitPane<HTMLDivElement>()
  const [matching, setMatching] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  const [undo, setUndo] = useState<{ stamp: number; ref: string; at: number } | null>(null)
  // Moving on ends the Undo offer; without this it sat beside Restore on the deleted page.
  const view = `${openRef}|${screen}`
  const [lastView, setLastView] = useState(view)
  if (view !== lastView) {
    setLastView(view)
    if (openRef || screen !== 'list') setUndo(null)
  }
  const p = r.proposal
  const ready = !!p && r.walk?.status === 'ready'

  // a. The selected entry: No location yet first if any, else the first location, else All.
  const needs = !!p?.observations.some((o) => !o.locationRef)
  const known = [
    edit.ALL,
    ...(needs ? [edit.NEEDS_LOCATION] : []),
    ...(p?.locations.map((l) => l.ref) ?? []),
  ]
  const firstLocation = p ? edit.groupProposal(p).groups[0]?.levels[0]?.locations[0]?.ref : null
  const selected =
    picked && known.includes(picked)
      ? picked
      : needs
        ? edit.NEEDS_LOCATION
        : (firstLocation ?? edit.ALL)
  const location = p?.locations.find((l) => l.ref === selected) ?? null
  const title = location
    ? location.name
    : selected === edit.NEEDS_LOCATION
      ? 'No location yet'
      : 'All locations'
  const open = p?.observations.find((o) => o.ref === openRef) ?? null
  const openDeleted = open ? null : (p?.removed?.find((o) => o.ref === openRef) ?? null)
  const name = r.walk ? walkName(r.walk) : 'Site walk'

  const pick = (ref: string) => {
    setPicked(ref)
    setOpenRef(null)
  }
  const change = (ref: string, patch: Parameters<typeof edit.updateObservation>[2]) =>
    r.change((cur) => edit.updateObservation(cur, ref, patch))

  // Add observation opens the Add manually screen (round 3), once the edits so
  // far are saved: it adds to the saved proposal. It offers the proposal's
  // locations and the assessment's others not linked yet.
  async function addObservation() {
    if (!p || !(await r.save())) return
    const linked = p.locations.map((l) => l.existingId)
    openProposalCapture({
      reference,
      walkId,
      locations: [
        ...p.locations.map((l) => ({
          id: l.ref,
          building: l.building,
          floor: l.floor,
          name: l.name,
        })),
        ...r.existing.filter((l) => !linked.includes(l.id)),
      ],
      locationId: p.locations.some((l) => l.ref === selected) ? selected : null,
    })
  }

  // b. Delete an observation: it goes to Deleted observations, and Undo puts it
  // back where it was.
  function deleteObservation(o: ProposedObservation) {
    const at = p!.observations.findIndex((x) => x.ref === o.ref)
    r.change((cur) => edit.removeObservation(cur, o.ref))
    setOpenRef(null)
    setUndo({ stamp: Date.now(), ref: o.ref, at })
  }
  function restore(ref: string) {
    r.change((cur) => edit.restoreObservation(cur, ref))
    setOpenRef(null)
    notify('Observation restored')
  }

  const matchingLocation = p?.locations.find((l) => l.ref === matching)
  const renaming = form?.kind === 'rename' ? p?.locations.find((l) => l.ref === form.ref) : null
  const removingLocation = p?.locations.find((l) => l.ref === removing)

  // c. The back controls: a page goes back to the screen it opened over, a foot
  // screen to the proposal, and the proposal out of the review.
  const toProposal = { label: name, onClick: () => setScreen('list') }
  const pageBack = {
    label: screen === 'list' ? name : SCREEN_TITLE[screen],
    onClick: () => setOpenRef(null),
  }
  const back = {
    label: backTo,
    // Leaves only once the last edits are saved: if that fails, the review
    // stays open with the reason, or the only copy of the edits would be lost.
    onClick: () => void r.save().then((saved) => saved && onClose()),
  }
  const page = open ?? openDeleted

  return (
    <div className="ob swr">
      {!page && screen === 'list' && (
        <ProposalHeader
          back={back}
          name={name}
          proposal={ready ? p : null}
          saveState={r.saveState}
          creating={r.creating}
          onSave={() => void r.save()}
          onRename={() => setNaming({ busy: false, problem: null })}
          onFix={() => {
            const first = p && edit.firstIncomplete(p)
            if (first) setOpenRef(first.ref)
          }}
          onCreate={() =>
            void r.create().then((created) => created && onCreated(edit.createdMessage(p!)))
          }
        />
      )}
      {!page && screen === 'deleted' && (
        <ScreenHeader
          title={SCREEN_TITLE.deleted}
          back={name}
          onBack={toProposal.onClick}
          badge={<ObservationBadge kind="proposal" />}
        />
      )}
      {r.problem && ready && !page && (
        <p className="swr-problem" role="alert">
          {r.problem}
        </p>
      )}
      {!ready || !p ? (
        <WalkStatusMessage walk={r.walk} problem={r.problem} onRetry={() => void r.retry()} />
      ) : (
        // Inert while Create all runs: the server locks the proposal after its first save,
        // so an edit made now would be lost.
        <div inert={r.creating}>
          {page ? (
            <ProposalPage
              key={page.ref}
              proposal={p}
              observation={page}
              walk={r.walk!}
              deleted={!!openDeleted}
              back={pageBack}
              saveState={r.saveState}
              problem={r.problem}
              onChange={(patch) => change(page.ref, patch)}
              onDelete={() => deleteObservation(page)}
              onRestore={() => restore(page.ref)}
              onStep={setOpenRef}
              onView={setViewing}
            />
          ) : screen === 'photos' || screen === 'pages' ? (
            <ProposalMedia
              kind={screen}
              proposal={p}
              walk={r.walk!}
              back={toProposal}
              onOpen={setOpenRef}
              onView={setViewing}
            />
          ) : screen === 'deleted' ? (
            <DeletedProposalTable
              proposal={p}
              media={r.walk?.media}
              filters={filters}
              onFilters={setFilters}
              onOpen={setOpenRef}
              onRestore={restore}
            />
          ) : (
            <div ref={pane} className="ob-layout" data-fit="">
              <ProposalNavigator
                proposal={p}
                selected={selected}
                title={title}
                phone={phone}
                onPick={pick}
                onAdd={() => setForm({ kind: 'add' })}
                onPhotos={() => setScreen('photos')}
                onScans={() => setScreen('pages')}
                onDeleted={() => setScreen('deleted')}
                actions={{
                  rename: (ref) => setForm({ kind: 'rename', ref }),
                  useExisting: setMatching,
                  remove: setRemoving,
                }}
              />
              <ProposalTable
                proposal={p}
                media={r.walk?.media}
                selected={selected}
                location={location}
                title={title}
                filters={filters}
                onFilters={setFilters}
                onAdd={() => void addObservation()}
                onOpen={setOpenRef}
              />
            </div>
          )}
        </div>
      )}

      {undo && (
        <UndoToast
          key={undo.stamp}
          onUndo={() => {
            r.change((cur) => edit.restoreObservation(cur, undo.ref, undo.at))
            setUndo(null)
          }}
          onDismiss={() => setUndo(null)}
        />
      )}
      {naming && r.walk && (
        <WalkNameDialog
          title="Rename proposal"
          action="Save"
          initial={walkName(r.walk)}
          phone={phone}
          busy={naming.busy}
          problem={naming.problem}
          onClose={() => setNaming(null)}
          onSave={(name) => {
            setNaming({ busy: true, problem: null })
            void r.rename(name).then((problem) => {
              setNaming(problem ? { busy: false, problem } : null)
              if (!problem) notify('Proposal renamed')
            })
          }}
        />
      )}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
      {form && p && (
        <LocationForm
          title={form.kind === 'add' ? 'Add location' : 'Rename location'}
          action={form.kind === 'add' ? 'Add location' : 'Save'}
          initial={renaming ? edit.inputOf(renaming) : undefined}
          known={[...p.locations, ...r.existing]}
          phone={phone}
          check={(input) =>
            edit.locationProblem(p, input, form.kind === 'rename' ? form.ref : undefined)
          }
          onClose={() => setForm(null)}
          onSave={(input) => {
            if (form.kind === 'rename') {
              r.change((cur) => edit.renameLocation(cur, form.ref, input))
              notify('Location renamed')
            } else {
              const added = edit.addLocation(p, input, r.existing)
              r.change(() => added.proposal)
              pick(added.location.ref)
              notify('Location added')
            }
            setForm(null)
          }}
        />
      )}
      {matchingLocation && p && (
        <ExistingLocationDialog
          name={matchingLocation.name}
          existing={r.existing}
          phone={phone}
          onClose={() => setMatching(null)}
          onPick={(existing) => {
            const done = edit.sameAs(p, matchingLocation.ref, existing)
            r.change(() => done.proposal)
            pick(done.ref)
            setMatching(null)
            notify('Now uses ' + existing.name)
          }}
        />
      )}
      {removingLocation && p && (
        <RemoveLocationDialog
          name={removingLocation.name}
          count={edit.observationsAt(p, removingLocation.ref).length}
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            r.change((cur) => edit.removeLocation(cur, removingLocation.ref))
            if (selected === removingLocation.ref) pick(edit.NEEDS_LOCATION)
            setRemoving(null)
            notify('Location deleted')
          }}
        />
      )}
    </div>
  )
}
