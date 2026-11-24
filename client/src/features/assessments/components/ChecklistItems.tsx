// The checklist as one flat, plain list (CP-37): a header per report section, its questions as
// rows, at most 8 shown with "Show more". Shown on the Checklist tab, in the site-walk pane and in
// the phone sheet. Called by screens/Checklist.tsx and ChecklistSheet.tsx. Calls the mark, edit,
// remove and add endpoints in api.ts; an observation for a difference goes through AnswerDialog.
import { useEffect, useState } from 'react'
import { toast } from '../../../design-system'
import {
  GatewayError,
  editChecklistItem,
  markChecklistItem,
  removeChecklistItem,
  saveObservation,
  startCaptureSession,
  type ChecklistItem,
  type ChecklistView,
  type ReportSection,
  type SavedObservation,
} from '../api'
import { country } from '../checklistChecks'
import { AddChecklistItem } from './AddChecklistItem'
import { AnswerDialog, type Answer, type AnswerPlace } from './ChecklistAnswer'
import { ChecklistRow, type Mark } from './ChecklistRow'
import '../checklist.css'

// What answering needs from the screen showing the checklist; null for anyone
// but the assigned engineer, who sees the answers only.
export type ChecklistAnswering = {
  place: AnswerPlace
  // An observation saved from the checklist, for the screen's own lists.
  onSaved: (observation: SavedObservation) => void
  // Differs, to record in full capture instead.
  onFullCapture: (item: ChecklistItem) => void
}

const SHOWN = 8
const FLASH_MS = 2000
const HAZARDS = 'hazards'

// Fixed first, then past-report questions, then the rest; the list's own order within each.
const rank = (i: ChecklistItem) => (i.fixed ? 0 : i.origin === 'past_report' ? 1 : 2)
const byRank = (items: ChecklistItem[]) =>
  items
    .map((item, at) => ({ item, at }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.at - b.at)
    .map((x) => x.item)

// The same view with one item's check replaced, to show a mark before the gateway answers.
function withMark(view: ChecklistView, itemId: string, mark: Mark | null): ChecklistView {
  const checklist = view.checklist!
  return {
    ...view,
    checklist: {
      ...checklist,
      items: checklist.items.map((i) =>
        i.id !== itemId
          ? i
          : {
              ...i,
              check: mark && {
                result: mark,
                at: new Date().toISOString(),
                by: '',
                observation: null,
              },
            },
      ),
    },
  }
}

/** Returns the checklist's sections and rows, with the Add item form after them. */
export function ChecklistItems({
  reference,
  view,
  setView,
  reload,
  answering,
  regenerateHint,
  onViewObservation,
  customising = false,
  openArea,
  openItem,
  highlight,
}: {
  reference: string
  view: ChecklistView & { checklist: NonNullable<ChecklistView['checklist']> }
  // Kept for the callers that still pass it; the plain list does not show drafting needs.
  sections?: ReportSection[] | null
  setView: (view: ChecklistView) => void
  reload: () => Promise<void>
  answering: ChecklistAnswering | null
  regenerateHint: string
  onViewObservation: (observationId: string) => void
  // On the tab, for the assigned engineer. The engineer answering on site can change items too.
  customising?: boolean
  // A report section's title to open on, from a MarshBot link (AS-06).
  openArea?: string
  // A checklist item's id to scroll to and flash, from a MarshBot link (AS-06).
  openItem?: string
  // Items that may replace answers a regenerate did not keep: shown with the flash tint.
  highlight?: Set<string>
}) {
  const checklist = view.checklist
  const canChange = !!answering || customising
  const live = checklist.items.filter((i) => i.status !== 'removed')
  const groups = [
    { id: HAZARDS, title: 'Priority risks' },
    ...checklist.areas.map((a) => ({ id: a.id, title: a.title })),
  ]
    .map((g) => ({ ...g, items: byRank(live.filter((i) => i.area === g.id)) }))
    .filter((g) => g.items.length)
  const linked = live.find((i) => i.id === openItem)
  const target = checklist.areas.find((a) => a.title === openArea)?.id ?? linked?.area
  // A section holding the linked item opens at once, so the item can be scrolled to.
  const [open, setOpen] = useState(() => {
    const g = groups.find((x) => x.id === target)
    return new Set(g && g.items.length > SHOWN ? [g.id] : [])
  })
  const [flash, setFlash] = useState<string | null>(linked?.id ?? null)
  useEffect(() => {
    const el = document.getElementById(
      openItem ? 'checklist-item-' + openItem : target ? 'checklist-area-' + target : '',
    )
    el?.scrollIntoView?.({ block: openItem ? 'center' : 'start' })
    if (!openItem) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [target, openItem])
  const [undo, setUndo] = useState<ChecklistItem | null>(null)
  const [answeringItem, setAnsweringItem] = useState<ChecklistItem | null>(null)
  const failed = (title: string, e: unknown) =>
    toast.error(title, { description: e instanceof GatewayError ? e.message : 'Try again.' })

  // Optimistic: the box changes at once; if the gateway refuses, it goes back and says so.
  const mark = async (item: ChecklistItem, next: Mark | null) => {
    const before = view
    setView(withMark(view, item.id, next))
    try {
      setView(await markChecklistItem(reference, item.id, next))
    } catch (e: unknown) {
      setView(before)
      failed("Couldn't save the mark", e)
    }
  }
  const saveText = async (item: ChecklistItem, text: string) => {
    try {
      setView(await editChecklistItem(reference, item.id, { text }))
    } catch (e: unknown) {
      failed("Couldn't save the change", e)
      throw e
    }
  }
  const remove = async (item: ChecklistItem) => {
    try {
      setView(await removeChecklistItem(reference, item.id))
      setUndo(item)
    } catch (e: unknown) {
      failed("Couldn't remove the item", e)
    }
  }
  const restore = async (item: ChecklistItem) => {
    try {
      setView(await removeChecklistItem(reference, item.id, true))
      setUndo(null)
    } catch (e: unknown) {
      failed("Couldn't restore the item", e)
    }
  }
  // Recording a difference: on site an answer is saved where the engineer is, so that comes first.
  const record = (item: ChecklistItem) => {
    const place = answering!.place
    if (place.kind === 'site' && !place.location) return place.choose()
    setAnsweringItem(item)
  }
  const saveDifference = async (item: ChecklistItem, answer: Answer) => {
    // Every observation belongs to a capture session; starting one is safe to repeat.
    if (answering!.place.kind === 'tab') await startCaptureSession(reference)
    const saved = await saveObservation(
      reference,
      {
        note: answer.note,
        copeDimensions: item.COPE_dimension.length ? item.COPE_dimension : null,
        severity: answer.severity,
        locationId: answer.locationId,
        checklistItem: { itemId: item.id, result: 'differs' },
      },
      [],
      answer.photos.map((photo) => ({ name: photo.name, image: photo })),
    )
    answering!.onSaved(saved)
    setAnsweringItem(null)
    await reload().catch(() => undefined)
  }
  const outOfDate =
    checklist.facilityType !== view.scope.facilityType ||
    checklist.jurisdiction !== view.scope.jurisdiction

  return (
    <div data-walk="checklist.answers">
      {outOfDate && (
        <p className="cl-note">
          This checklist was made for {checklist.facilityType} in {country(checklist.jurisdiction)};
          the site is now {view.scope.facilityType} in {country(view.scope.jurisdiction)}.{' '}
          {regenerateHint}
        </p>
      )}
      {checklist.notes?.map((note) => (
        <p key={note} className="cl-note">
          {note}
        </p>
      ))}
      {undo && (
        <p className="cl-note" role="status">
          Removed.{' '}
          <button type="button" className="cl-link" onClick={() => void restore(undo)}>
            Undo
          </button>
        </p>
      )}
      {groups.map((g) => {
        const expanded = open.has(g.id)
        const rows = expanded ? g.items : g.items.slice(0, SHOWN)
        const more = g.items.length - SHOWN
        const toggle = () => {
          const next = new Set(open)
          if (expanded) next.delete(g.id)
          else next.add(g.id)
          setOpen(next)
        }
        return (
          <section
            key={g.id}
            id={'checklist-area-' + g.id}
            className="cl-section"
            aria-label={g.title}
          >
            <div className="cl-head">
              <h3>{g.title}</h3>
              <span className="cl-count">
                {g.items.filter((i) => i.check).length} of {g.items.length}
              </span>
            </div>
            <ul className="cl-rows">
              {rows.map((item) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  canChange={canChange}
                  flash={flash === item.id || !!highlight?.has(item.id)}
                  onMark={(next) => void mark(item, next)}
                  onSaveText={(text) => saveText(item, text)}
                  onRemove={() => void remove(item)}
                  onRecord={answering?.place.kind === 'site' ? () => record(item) : undefined}
                  onViewObservation={onViewObservation}
                />
              ))}
            </ul>
            {more > 0 && (
              <button type="button" className="cl-link" onClick={toggle}>
                {expanded ? 'Show less' : `Show ${more} more`}
              </button>
            )}
          </section>
        )
      })}
      {canChange && (
        <AddChecklistItem
          reference={reference}
          sections={checklist.areas}
          onAdded={(next) => {
            setView(next)
            setUndo(null)
          }}
        />
      )}
      {answeringItem && answering && (
        <AnswerDialog
          reference={reference}
          kind="differs"
          item={answeringItem}
          place={answering.place}
          onClose={() => setAnsweringItem(null)}
          onSave={(given) => saveDifference(answeringItem, given)}
          onFullCapture={() => {
            setAnsweringItem(null)
            answering.onFullCapture(answeringItem)
          }}
        />
      )}
    </div>
  )
}
