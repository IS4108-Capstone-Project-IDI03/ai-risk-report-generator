// The Calendar (CP-60), from the sidebar: an engineer's surveys and report due
// dates by month or week, with the late reports and the assessments that have no
// survey date beside it. Drawn from the work list (GET /api/assessments), so it
// shows exactly the assessments its reader may open: their own, or the whole
// team's for a knowledge admin. Rendered by AssessmentApp. Calls CalendarGrid,
// DayList, Entry and RescheduleDialog; its dates and layout are in ../calendar.ts.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ASSESSMENT_TYPES,
  Button,
  EmptyState,
  IconButton,
  SegmentedControl,
  TableFooter,
  TopBar,
  toast,
  useIsPhone,
  type AssessmentType,
} from '../../../design-system'
import type { Assessment } from '../../assessments/api'
import { FilterMenu } from '../../clients/components/FilterMenu'
import { assessmentType, plural } from '../../clients/formatClient'
import {
  NewAssessmentButton,
  type StartMode,
} from '../../new-assessment/components/NewAssessmentButton'
import {
  addDays,
  addMonths,
  agenda,
  canReschedule,
  dueOf,
  layoutWeek,
  monthStart,
  monthWeeks,
  periodLabel,
  todayIso,
  toItems,
  weekStart,
  type CalendarItem,
  type Show,
  type View,
} from '../calendar'
import { CalendarGrid } from '../components/CalendarGrid'
import { DayList } from '../components/DayList'
import { EntryRow, type EntryContext } from '../components/Entry'
import { PeriodPicker } from '../components/PeriodPicker'
import { RescheduleDialog } from '../components/RescheduleDialog'
import { keptViews, type KeptView } from '../keptView'
import '../../assessments/assessment-list.css'
import '../../clients/clients.css'
import '../calendar.css'

const SHOWS = [
  { value: 'surveys', label: 'Survey dates', icon: 'flag', color: 'var(--report-navy)' },
  { value: 'due', label: 'Report due dates', icon: 'calendar', color: 'var(--graphite-600)' },
]
// Each type wears its tile's icon and colour (design system section 2).
const TYPES = (Object.keys(ASSESSMENT_TYPES) as AssessmentType[]).map((type) => ({
  value: type,
  label: type,
  icon: ASSESSMENT_TYPES[type].icon,
  color: ASSESSMENT_TYPES[type].fg,
}))

export function Calendar({
  assessments,
  loading,
  failed,
  me,
  team,
  onOpen,
  onStart,
  onChanged,
  bell,
  today = todayIso(),
}: {
  // The work list: every assessment the reader may open.
  assessments: Assessment[]
  loading: boolean
  failed: boolean
  me: { id: string; name: string }
  // The work list holds every engineer's assessments (a knowledge admin's).
  team: boolean
  onOpen: (reference: string, site: string) => void
  // Starts a new assessment, on a day when one was picked; absent for someone who may not.
  onStart?: (mode: StartMode, siteVisitDate?: string) => void
  // After new dates are saved: the work list is read again.
  onChanged: () => void
  // The notification bell, on desktop.
  bell?: ReactNode
  // "Today"; tests pass a fixed day.
  today?: string
}) {
  const phone = useIsPhone()
  const [state, setState] = useState<KeptView>(
    () => keptViews.get(me.id) ?? { view: 'month', day: today, show: '', type: '', engineer: '' },
  )
  useEffect(() => {
    keptViews.set(me.id, state)
  }, [me.id, state])
  const set = (patch: Partial<KeptView>) => {
    setOpenKey(null)
    setState((previous) => ({ ...previous, ...patch }))
  }
  // The one entry whose details are open, and the assessment being rescheduled.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState<CalendarItem | null>(null)

  // Seven columns do not fit a phone, which lists the month instead.
  const view: View = phone ? 'month' : state.view
  const cursor = view === 'month' ? monthStart(state.day) : weekStart(state.day)
  const step = (by: number) =>
    set({ day: view === 'month' ? addMonths(cursor, by) : addDays(state.day, by * 7) })

  const items = useMemo(() => toItems(assessments), [assessments])
  const engineers = useMemo(
    () =>
      [...new Map(items.flatMap((i) => (i.engineer ? [[i.engineer.id, i.engineer]] : []))).values()]
        .map((e) => ({ value: e.id, label: e.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [items],
  )
  // A filter kept from before that no longer names anyone here is no filter.
  const engineer = team && engineers.some((e) => e.value === state.engineer) ? state.engineer : ''
  const shown = items.filter(
    (i) =>
      (!state.type || assessmentType(i.type) === state.type) &&
      (!engineer || i.engineer?.id === engineer),
  )
  const late = shown
    .filter((i) => dueOf(i, today)?.state === 'late')
    .sort((a, b) => a.due!.localeCompare(b.due!))
  const unscheduled = shown.filter((i) => !i.start)

  const ctx: EntryContext = {
    today,
    meId: me.id,
    team,
    openKey,
    setOpenKey,
    onOpen: (item) => onOpen(item.reference, item.site),
    onReschedule: (item) => {
      setOpenKey(null)
      setRescheduling(item)
    },
  }
  const filtered = !!state.show || !!state.type || !!engineer
  return (
    <div className="cl-page cal-page">
      <TopBar
        eyebrow="Risk engineering"
        title="Calendar"
        helper={
          team
            ? 'Surveys and report due dates for every assessment across the team.'
            : 'Surveys and report due dates for every assessment you are working on.'
        }
        bell={bell}
        // Beside the bell at every width: the toolbar is full with the period and filters.
        action={
          onStart ? (
            <span className="at-topnew">
              <NewAssessmentButton onStart={onStart} />
            </span>
          ) : undefined
        }
      />
      <div className="cl-content cl-content--list">
        <div className="cal-layout">
          <section aria-label="Calendar" className="cl-card cal-card">
            <div className="cl-toolbar cal-toolbar">
              <div className="cal-stepper">
                <IconButton
                  icon="chevron-left"
                  label={`Previous ${view}`}
                  onClick={() => step(-1)}
                />
                <div className="cal-period">
                  {/* In the month view the month and the year are buttons that choose
                      another; the period is still read out from the hidden line. */}
                  {view === 'month' && (
                    <PeriodPicker
                      year={+cursor.slice(0, 4)}
                      month={+cursor.slice(5, 7) - 1}
                      onGo={(y, m) => set({ day: `${y}-${String(m + 1).padStart(2, '0')}-01` })}
                    />
                  )}
                  <strong
                    role="status"
                    aria-label="Period shown"
                    className={view === 'month' ? 'ds-sr-only' : undefined}
                  >
                    {periodLabel(view, cursor)}
                  </strong>
                </div>
                <IconButton icon="chevron-right" label={`Next ${view}`} onClick={() => step(1)} />
              </div>
              <Button variant="pill" pill onClick={() => set({ day: today })}>
                {'Today'}
              </Button>
              {!phone && (
                <SegmentedControl
                  ariaLabel="View"
                  options={[
                    { value: 'month', label: 'Month' },
                    { value: 'week', label: 'Week' },
                  ]}
                  value={view}
                  onChange={(next: View) =>
                    set({
                      view: next,
                      // A month opens on today's week when it holds today, else on its first.
                      day:
                        next === 'week' && view === 'month'
                          ? monthStart(today) === cursor
                            ? today
                            : cursor
                          : state.day,
                    })
                  }
                />
              )}
              <div className="cl-pills cal-pills">
                <FilterMenu
                  name="All dates"
                  anyLabel="All dates"
                  choices={SHOWS}
                  value={state.show}
                  onChange={(show) => set({ show: show as Show })}
                />
                <FilterMenu
                  name="Assessment type"
                  choices={TYPES}
                  value={state.type}
                  onChange={(type) => set({ type })}
                />
                {team && (
                  <FilterMenu
                    name="Engineer"
                    choices={engineers}
                    value={engineer}
                    onChange={(next) => set({ engineer: next })}
                  />
                )}
              </div>
            </div>
            {loading ? (
              <p role="status" className="cl-empty-title">
                {'Loading your calendar…'}
              </p>
            ) : failed ? (
              <EmptyState
                icon="calendar"
                title="Your calendar could not be loaded"
                description="The gateway could not be reached. Check your connection and try again."
              />
            ) : phone ? (
              <DayList
                days={agenda(shown, cursor, addDays(addMonths(cursor, 1), -1), state.show)}
                ctx={ctx}
              />
            ) : (
              <CalendarGrid
                view={view}
                weeks={
                  view === 'month'
                    ? monthWeeks(shown, cursor, state.show)
                    : [layoutWeek(shown, cursor, state.show)]
                }
                month={view === 'month' ? cursor.slice(0, 7) : null}
                ctx={ctx}
                onWeek={(day) => set({ view: 'week', day })}
                onAdd={onStart ? (day) => onStart('form', day) : undefined}
              />
            )}
            {!loading && !failed && (
              <TableFooter
                late={late.length ? plural(late.length, 'report') + ' late' : undefined}
                // To the month of the report longest late, showing reports only.
                onLateClick={() => set({ view: 'month', day: late[0].due!, show: 'due' })}
              >
                {plural(shown.length, 'assessment')}
              </TableFooter>
            )}
          </section>
          {!loading && !failed && (
            <aside className="cal-side" aria-label="Needs planning">
              <section className="cl-card cal-side-card" aria-labelledby="cal-late">
                <h2 id="cal-late">
                  {'Late reports'}
                  <span className="cal-count" data-late={late.length ? '' : undefined}>
                    {late.length}
                  </span>
                </h2>
                {late.length ? (
                  late.map((item) => (
                    <EntryRow
                      key={item.reference}
                      entryKey={`due:${item.reference}`}
                      item={item}
                      kind="due"
                      ctx={ctx}
                      where="late"
                      align="right"
                      showDate
                    />
                  ))
                ) : (
                  <p className="cal-side-none">
                    {filtered ? 'No late reports match.' : 'No reports are late.'}
                  </p>
                )}
              </section>
              <section className="cl-card cal-side-card" aria-labelledby="cal-unscheduled">
                <h2 id="cal-unscheduled">
                  {'No survey date'}
                  <span className="cal-count">{unscheduled.length}</span>
                </h2>
                {unscheduled.length ? (
                  unscheduled.map((item) => (
                    <div key={item.reference} className="cal-side-row">
                      <EntryRow
                        entryKey={`survey:${item.reference}`}
                        item={item}
                        kind="survey"
                        ctx={ctx}
                        where="unscheduled"
                        align="right"
                      />
                      {canReschedule(item, me.id) && (
                        <IconButton
                          icon="calendar-plus"
                          label={`Set dates for ${item.site}`}
                          tooltip="Set dates"
                          onClick={() => ctx.onReschedule(item)}
                        />
                      )}
                    </div>
                  ))
                ) : (
                  <p className="cal-side-none">
                    {filtered
                      ? 'None without a survey date match.'
                      : 'Every assessment has a survey date.'}
                  </p>
                )}
              </section>
            </aside>
          )}
        </div>
      </div>
      {rescheduling && (
        <RescheduleDialog
          item={rescheduling}
          onClose={() => setRescheduling(null)}
          onSaved={() => {
            toast.success('Dates saved for ' + rescheduling.reference)
            setRescheduling(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
