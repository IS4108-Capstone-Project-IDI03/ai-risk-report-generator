// The Observations tab (CP-22): the location navigator beside a compact list
// whose toolbar holds the site walks and the two ways to capture (record a
// site walk or add manually), and each observation's own page. Rendered by AssessmentApp.tsx;
// the data and saves are in useAssessmentWorkflow.tsx, the site walk screens in
// features/site-walk.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, Icon } from '../../../design-system'
import {
  discardWalk,
  retryWalk,
  siteWalkReview,
  SiteWalkRecording,
  SiteWalkReview,
  useKeptUploads,
  useSiteWalks,
} from '../../site-walk'
import { ScreenHeader } from '../components/ScreenHeader'
import { AddMediaDialog } from '../components/AddMediaDialog'
import { LocationForm, RemoveLocationDialog } from '../components/LocationSheet'
import { LocationNavigator } from '../components/LocationNavigator'
import { openWalks } from '../openWalks'
import { DeleteDialog, RemoveMediaDialog, TranscriptDialog } from '../components/ObservationDialogs'
import { ObservationFilters } from '../components/ObservationFilters'
import { ObservationList } from '../components/ObservationList'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useFitPane } from '../useFitPane'
import { useObservationsView } from '../useObservationsView'
import { ObservationPage } from './ObservationPage'
import { SiteWalks } from './SiteWalks'
import '../observations.css'

// `from`: a recording or review opened in the Site Walk Proposals list goes Back to it.
// `open`: the proposed observation open in the review.
type WalkScreen =
  | { kind: 'record'; from?: 'list' }
  | { kind: 'review'; walkId: string; from?: 'list'; open?: string }
  | { kind: 'list' }
  | null
// The open review, kept outside React: Add observation unmounts this tab, and
// without this its Back would forget the review came from the list.
let openReview: { walkId: string; from?: 'list' } | null = null

// The walk screen in the URL (?walk=list, ?walk=record[.list],
// ?walk=<id>[.list][.<observation ref>]), so a refresh reopens it. A reopened
// recording resumes the open walk; its microphone waits for a tap.
function walkFromUrl(): WalkScreen {
  const w = new URLSearchParams(window.location.search).get('walk')
  if (!w) return null
  if (w === 'list') return { kind: 'list' }
  const [id, ...rest] = w.split('.')
  const from = rest.includes('list') ? { from: 'list' as const } : {}
  if (id === 'record') return { kind: 'record', ...from }
  const open = rest.find((part) => part !== 'list')
  return { kind: 'review', walkId: id, ...from, ...(open && { open }) }
}
function walkParam(walk: WalkScreen): string | null {
  if (!walk) return null
  if (walk.kind === 'list') return 'list'
  const id = walk.kind === 'record' ? 'record' : walk.walkId
  return [id, walk.from, walk.kind === 'review' && walk.open].filter(Boolean).join('.')
}

export function Observations({ v }: { v: AssessmentWorkflow }) {
  const view = useObservationsView(v)
  const { walks, reload } = useSiteWalks(v.captureRef)
  const [walk, setWalk] = useState<WalkScreen>(walkFromUrl)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const param = walkParam(walk)
    if (param === q.get('walk')) return
    if (param) q.set('walk', param)
    else q.delete('walk')
    window.history.replaceState(null, '', window.location.pathname + '?' + q.toString())
  }, [walk])
  const waiting = useKeptUploads(v.captureRef, reload)
  // The bell's "site walk ready" opens its review, whether this tab was already
  // showing or is only now mounting.
  useEffect(() => {
    const take = () => {
      const walkId = siteWalkReview.walkId
      if (!walkId) return
      const before = openReview?.walkId === walkId ? openReview.from : undefined
      // Back goes to the screen it opened over: the list, or else the tab.
      setWalk((cur) => ({ kind: 'review', walkId, from: cur?.kind === 'list' ? 'list' : before }))
      siteWalkReview.walkId = null
    }
    take()
    window.addEventListener(siteWalkReview.event, take)
    return () => window.removeEventListener(siteWalkReview.event, take)
  }, [])
  useEffect(() => {
    openReview = walk?.kind === 'review' ? walk : null
  }, [walk])
  // The review reports its open observation, so the URL carries it. Stable, and
  // a no-op when unchanged: the review calls it from an effect.
  const reviewOpened = useCallback(
    (ref: string | null) =>
      setWalk((cur) =>
        cur?.kind === 'review' && (cur.open ?? null) !== ref
          ? { ...cur, open: ref ?? undefined }
          : cur,
      ),
    [],
  )
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  // The title, navigator and table stay put; only the table scrolls (round 3).
  const pane = useFitPane<HTMLDivElement>()
  const open = v.obsList.find((o) => o.open)
  // Back from capture, the list scrolls once to the newest saved, and focus
  // goes there (CP-16).
  const page = useRef<HTMLDivElement>(null)
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || !v.obsReturning || open) return
    const target = page.current?.querySelector<HTMLElement>('[data-landing]')
    if (!target) return
    landed.current = true
    target.scrollIntoView?.({ block: 'center' })
    target.focus({ preventScroll: true })
  })

  // a. Recording a site walk takes the whole screen; its review sits in this tab.
  if (walk?.kind === 'record')
    return (
      <SiteWalkRecording
        reference={v.captureRef}
        back={walk.from ? 'Site walk proposals' : 'Observations'}
        onClose={() => {
          setWalk(walk.from ? { kind: 'list' } : null)
          reload()
        }}
      />
    )
  if (walk?.kind === 'review')
    return (
      <SiteWalkReview
        reference={v.captureRef}
        walkId={walk.walkId}
        opened={walk.open}
        onOpen={reviewOpened}
        backTo={walk.from ? 'Site walk proposals' : 'Observations'}
        onClose={() => {
          setWalk(walk.from ? { kind: 'list' } : null)
          reload()
        }}
        notify={v.notify}
        onCreated={(message) => {
          v.notify(message)
          setWalk(null)
          reload()
          v.reloadAfterWalk()
        }}
      />
    )
  // b. Every walk with its details, on its own screen.
  if (walk?.kind === 'list')
    return (
      <SiteWalks
        walks={walks}
        waiting={waiting}
        onBack={() => setWalk(null)}
        onRecord={() => setWalk({ kind: 'record', from: 'list' })}
        onOpen={(w) =>
          setWalk(
            w.status === 'recording'
              ? { kind: 'record', from: 'list' }
              : { kind: 'review', walkId: w.id, from: 'list' },
          )
        }
        onRetry={(walkId) =>
          void retryWalk(v.captureRef, walkId)
            .then(() => {
              reload()
              v.notify('Reading the walk again')
            })
            .catch(() => v.notify('The walk could not be retried. Try again.', 'danger'))
        }
        onDelete={(walkId) =>
          discardWalk(v.captureRef, walkId).then(() => {
            reload()
            v.notify('Proposal deleted')
          })
        }
      />
    )
  const canCapture = v.canEdit && v.canCapture
  const shownWalks = openWalks(walks)
  const readyWalks = shownWalks.filter((w) => w.status === 'ready').length
  // Add manually opens capture at the location picked, when there is one.
  const addManually = view.location?.addObservation ?? v.goField
  return (
    <>
      <div ref={page} className="ob">
        {open ? (
          // c. One observation on its own page, edited in place.
          <ObservationPage key={open.key} v={v} o={open} order={view.order} onView={setViewing} />
        ) : (
          <>
            {/* d. Deleted observations get a header like the other sub-screens. */}
            {v.obsShowDeleted && (
              <ScreenHeader
                title="Deleted Observations"
                back="Observations"
                onBack={() => v.setObsShowDeleted(false)}
              />
            )}
            {/* e. The list's own header, then the navigator beside the list (above it on a phone). */}
            {!v.obsShowDeleted && <h2 className="ob-title">All Observations</h2>}
            <div ref={pane} className="ob-layout" data-fit="">
              {!v.obsShowDeleted && <LocationNavigator v={v} view={view} />}
              <div
                className="ob-card"
                style={{ gridColumn: v.obsShowDeleted ? '1 / -1' : undefined }}
              >
                {/* The filters on the left; the site walks and the two ways to capture on the right. */}
                <div className="ob-filters">
                  <div className="ob-filter-set">
                    <ObservationFilters v={v} />
                  </div>
                  {/* Deleted list: its count sits in the toolbar, by the table. */}
                  {v.obsShowDeleted && <span className="ob-count">{v.obsCountLabel}</span>}
                  {canCapture && !v.obsShowDeleted && (
                    <div className="ob-head-actions">
                      {(shownWalks.length > 0 || waiting > 0) && (
                        <button
                          type="button"
                          className="ob-button ob-button--tinted ob-walks-button"
                          aria-label={
                            readyWalks
                              ? `Site walk proposals, ${readyWalks} ready to review`
                              : `Site walk proposals (${shownWalks.length})`
                          }
                          onClick={() => setWalk({ kind: 'list' })}
                        >
                          <Icon name="list" size={16} />
                          <span>Site walk proposals</span>
                          {readyWalks > 0 && (
                            <span className="ob-pill" data-tone="navy">
                              {readyWalks}
                            </span>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        className="ob-button ob-button--primary"
                        aria-label="Record site walk"
                        onClick={() => setWalk({ kind: 'record' })}
                      >
                        <Icon name="mic" size={16} />
                        {/* One span, so the button's gap doesn't double the space before "site walk". */}
                        <span>
                          Record<span className="ob-more"> site walk</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ob-button ob-button--tinted"
                        aria-label="Add manually"
                        onClick={addManually}
                      >
                        <Icon name="plus" size={16} />
                        <span>
                          Add<span className="ob-more"> manually</span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                {/* The place picked in the navigator, above the table. */}
                {!v.obsShowDeleted && view.place.kind !== 'all' && (
                  <p className="ob-where">
                    <Icon name="map-pin" size={15} color="var(--marsh-navy)" />
                    {view.title}
                  </p>
                )}
                <ObservationList v={v} view={view} />
              </div>
            </div>
          </>
        )}
      </div>
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
      {/* Adding or changing a location (CP-16), as in the capture picker. */}
      {v.obsLocFormOpen && (
        <Dialog
          className={v.phone ? 'ds-dialog-sheet' : undefined}
          title={v.locEditing ? 'Edit location' : 'Add a location'}
          width={480}
          onClose={v.lfBusy ? undefined : v.cancelLocationForm}
        >
          <LocationForm v={v} />
        </Dialog>
      )}
      {!!v.locRemoveLabel && <RemoveLocationDialog key={v.locRemoveLabel} v={v} />}
      {v.obsDialog?.kind === 'transcript' && !!v.obsDialog.recording && (
        <TranscriptDialog
          key={v.obsDialog.key + v.obsDialog.recording.id}
          v={v}
          dialog={v.obsDialog}
        />
      )}
      {v.obsDialog?.kind === 'delete' && (
        <DeleteDialog key={v.obsDialog.key} v={v} dialog={v.obsDialog} />
      )}
      {v.obsDialog?.kind === 'addMedia' && (
        <AddMediaDialog key={v.obsDialog.key} v={v} dialog={v.obsDialog} />
      )}
      {v.obsDialog?.kind === 'removeMedia' && !!v.obsDialog.media && (
        <RemoveMediaDialog
          key={v.obsDialog.key + v.obsDialog.media.id}
          v={v}
          dialog={v.obsDialog}
        />
      )}
    </>
  )
}
