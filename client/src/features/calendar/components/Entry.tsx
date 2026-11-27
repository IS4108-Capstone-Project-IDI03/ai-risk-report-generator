// One calendar entry and its details (CP-60): a survey or a report due date, as a
// chip on the grid or a row in a list, each opening the same details (a popover,
// or a sheet on a phone). Called by CalendarGrid, DayList and screens/Calendar.tsx.
// Calls the design system's Popover, tiles, FactList, StatusPill and ReportDue.
import type { CSSProperties, ReactNode } from 'react'
import {
  ASSESSMENT_TYPES,
  AssessmentTypeTile,
  Button,
  Fact,
  FactList,
  Icon,
  IconTile,
  Popover,
  ReportDue,
  StatusPill,
} from '../../../design-system'
import { visitStage } from '../../assessments/format'
import { assessmentType } from '../../clients/formatClient'
import {
  canReschedule,
  daysBetween,
  dueOf,
  formatDay,
  formatSpan,
  isFinished,
  type CalendarItem,
  type DueState,
  type EntryKind,
} from '../calendar'

// What every entry needs from the screen: the day it is, who is looking, the
// one entry whose details are open, and what its two buttons do.
export type EntryContext = {
  today: string
  meId: string
  // Every engineer's assessments are shown (a knowledge admin), so entries name theirs.
  team: boolean
  openKey: string | null
  setOpenKey: (key: string | null) => void
  onOpen: (item: CalendarItem) => void
  onReschedule: (item: CalendarItem) => void
}

// A report due date's icon and colour, as the Report due cell's (ReportDue.tsx);
// done is a finalised report's tick.
const DUE_LOOK: Record<DueState, { icon: string; color: string }> = {
  late: { icon: 'calendar-x', color: 'var(--red-600)' },
  soon: { icon: 'calendar-clock', color: 'var(--amber-600)' },
  ok: { icon: 'calendar', color: 'var(--graphite-600)' },
  done: { icon: 'circle-check', color: 'var(--green-600)' },
}

// Why Reschedule is greyed out on someone else's assessment.
const NOT_MINE = {
  title: "Can't reschedule",
  text: 'Only the assigned engineer can change these dates.',
}

// What an entry says about itself, shared by its chip, row and spoken name.
function describe(item: CalendarItem, kind: EntryKind, ctx: EntryContext) {
  const type = assessmentType(item.type)
  const who = ctx.team ? (item.engineer?.name ?? 'Unassigned') : null
  if (kind === 'survey') {
    const when = item.start ? formatSpan(item.start, item.end) : 'No survey date'
    return {
      type,
      due: null,
      // The row's second line, and the chip's (week view), whose icon and colour say the
      // type. The engineer comes first: a long client name is cut, and must not cut them.
      line: [who, type, item.client].filter(Boolean).join(' · '),
      chipLine: [who, item.client].filter(Boolean).join(' · '),
      spoken: [type, item.site, item.client, when, who].filter(Boolean).join(', '),
    }
  }
  const due = dueOf(item, ctx.today)
  return {
    type,
    due,
    line: [who, 'Report due', item.client].filter(Boolean).join(' · '),
    // Short enough for a day's column, so it is never cut: "Due in 3 days", "6 days
    // late", "Finalised". The engineer is in the details and on the survey's bar.
    chipLine: !due
      ? 'Report due'
      : due.state === 'late'
        ? due.note
        : due.state === 'done'
          ? due.note[0].toUpperCase() + due.note.slice(1)
          : `Due ${due.note}`,
    spoken: [
      'Report due',
      item.site,
      item.client,
      item.due ? formatDay(item.due) : null,
      due?.note,
      who,
    ]
      .filter(Boolean)
      .join(', '),
  }
}

/** Returns the details of one assessment: its dates and people, Open assessment and Reschedule. */
function EntryDetails({ item, ctx }: { item: CalendarItem; ctx: EntryContext }) {
  const type = assessmentType(item.type)
  const mine = canReschedule(item, ctx.meId)
  return (
    <div className="cal-details">
      <div className="cal-details-head">
        <AssessmentTypeTile type={type} />
        <div>
          <strong className="cal-details-site">{item.site}</strong>
          <span>{item.client}</span>
          <span className="cal-details-ref">{item.reference}</span>
        </div>
      </div>
      <FactList>
        <Fact label="Assessment type">{type}</Fact>
        <Fact label="Status">
          <StatusPill status={visitStage(item)} />
        </Fact>
        <Fact label="Survey">{item.start ? formatSpan(item.start, item.end) : 'Not set'}</Fact>
        <Fact label="Report due">
          <ReportDue
            date={item.due}
            today={new Date(ctx.today + 'T00:00:00')}
            plain={isFinished(item)}
          />
        </Fact>
        {ctx.team && <Fact label="Engineer">{item.engineer?.name ?? 'Unassigned'}</Fact>}
        {item.contacts.length > 0 && (
          <Fact label={item.contacts.length === 1 ? 'Site contact' : 'Site contacts'} wide>
            {item.contacts.map((c) => (
              <span key={c.name + (c.role ?? '')} className="cal-details-contact">
                {c.role ? `${c.name}, ${c.role}` : c.name}
              </span>
            ))}
          </Fact>
        )}
      </FactList>
      <div className="cal-details-actions">
        <Button variant="primary" pill onClick={() => ctx.onOpen(item)}>
          {'Open assessment'}
        </Button>
        <Button
          variant="pill"
          pill
          onClick={() => ctx.onReschedule(item)}
          disabledReason={mine ? undefined : NOT_MINE}
        >
          {'Reschedule'}
        </Button>
      </div>
      {/* Where a reason box under the last button would not fit (a phone's sheet, a
          popover cut to the window's height), the reason is a line here (calendar.css). */}
      {!mine && <p className="cal-details-why">{NOT_MINE.text}</p>}
    </div>
  )
}

type EntryProps = {
  entryKey: string
  item: CalendarItem
  kind: EntryKind
  ctx: EntryContext
}

// The trigger and its details. `where` keeps two triggers for one entry apart
// (a late report is on the grid and in the side list; a long survey is in several
// weeks of the grid), so only the pressed one opens.
function EntryPop({
  entryKey,
  item,
  ctx,
  where,
  label,
  className,
  style,
  align,
  children,
}: Pick<EntryProps, 'entryKey' | 'item' | 'ctx'> & {
  where: string
  label: string
  className: string
  style?: CSSProperties
  align: 'left' | 'right'
  children: ReactNode
}) {
  const key = `${where}:${entryKey}`
  const open = ctx.openKey === key
  return (
    <Popover
      open={open}
      onOpenChange={(next) => ctx.setOpenKey(next ? key : null)}
      // The phone sheet's title.
      ariaLabel={item.site}
      align={align}
      className="cal-entry-anchor"
      surfaceClassName="cal-entry-surface"
      sheetClassName="cal-entry-sheet"
      style={{ display: 'flex', minWidth: 0, ...style }}
      trigger={
        <button
          type="button"
          className={className}
          aria-label={label}
          title={label}
          onClick={() => ctx.setOpenKey(open ? null : key)}
        >
          {children}
        </button>
      }
    >
      {/* Mounted by Popover only while it shows, and through its closing fade. */}
      <EntryDetails item={item} ctx={ctx} />
    </Popover>
  )
}

/** Returns an entry as the grid shows it: a tinted bar for a survey, a white chip for a report due. */
export function EntryChip({
  entryKey,
  item,
  kind,
  ctx,
  week,
  style,
  align,
  twoLines,
  fromEarlier,
  toLater,
}: EntryProps & {
  // The Monday of the week it is drawn in. A survey over several weeks is one bar in
  // each, and only the bar pressed opens its details.
  week: string
  style: CSSProperties
  align: 'left' | 'right'
  // The week view's taller chip, with a second line.
  twoLines: boolean
  fromEarlier?: boolean
  toLater?: boolean
}) {
  const d = describe(item, kind, ctx)
  const look = kind === 'survey' ? ASSESSMENT_TYPES[d.type] : null
  const due = d.due ? DUE_LOOK[d.due.state] : null
  return (
    <EntryPop
      entryKey={entryKey}
      item={item}
      ctx={ctx}
      where={`grid:${week}`}
      label={d.spoken}
      align={align}
      className="cal-chip"
      style={{
        ...style,
        // A survey running on from last week, or into the next, meets the week's edge.
        marginLeft: fromEarlier ? 0 : 4,
        marginRight: toLater ? 0 : 4,
        ['--chip-fg' as string]: look?.fg ?? (d.due?.state === 'ok' ? undefined : due?.color),
        ['--chip-bg' as string]: look?.bg,
      }}
    >
      <span
        className="cal-chip-body"
        data-kind={kind}
        data-from-earlier={fromEarlier || undefined}
        data-to-later={toLater || undefined}
      >
        <Icon name={look?.icon ?? due?.icon ?? 'calendar'} size={14} color={due?.color} />
        <span className="cal-chip-text">
          <span>{item.site}</span>
          {twoLines && <span className="cal-chip-line">{d.chipLine}</span>}
        </span>
      </span>
    </EntryPop>
  )
}

/** Returns an entry as a list shows it: its tile, two lines, and what is left to its date. */
export function EntryRow({
  entryKey,
  item,
  kind,
  ctx,
  where,
  align = 'left',
  showDate = false,
}: EntryProps & {
  // Which list it is in: 'late', 'unscheduled' or 'list'.
  where: string
  // Which edge of the row its details line up with. The side lists sit at the
  // window's right edge, so theirs open leftwards, over the grid.
  align?: 'left' | 'right'
  // The side lists give the due date itself, since no day heading does.
  showDate?: boolean
}) {
  const d = describe(item, kind, ctx)
  const due = d.due ? DUE_LOOK[d.due.state] : null
  const days = item.start && item.end ? daysBetween(item.start, item.end) + 1 : 1
  return (
    <EntryPop
      entryKey={entryKey}
      item={item}
      ctx={ctx}
      where={where}
      label={d.spoken}
      align={align}
      className="cal-row"
    >
      {kind === 'survey' ? (
        <AssessmentTypeTile type={d.type} />
      ) : (
        <IconTile
          icon={due?.icon ?? 'calendar'}
          tone="outline"
          style={{ color: due?.color ?? 'var(--graphite-600)' }}
        />
      )}
      <span className="cal-row-text">
        <span>{item.site}</span>
        <span>{d.line}</span>
      </span>
      {kind === 'due' && d.due ? (
        <span className="cal-row-note" data-state={d.due.state}>
          {showDate && item.due && <span>{formatDay(item.due)}</span>}
          <span>{d.due.note}</span>
        </span>
      ) : (
        days > 1 && <span className="cal-row-note">{`${days} days`}</span>
      )}
    </EntryPop>
  )
}
