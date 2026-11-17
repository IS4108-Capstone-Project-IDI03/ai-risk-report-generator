// CP-60: the calendar's dates and layout, on fixed days.
import { describe, expect, it } from 'vitest'
import type { Assessment } from '../assessments/api'
import {
  addMonths,
  agenda,
  dueOf,
  layoutWeek,
  monthWeeks,
  periodLabel,
  toItems,
  weekStart,
  type CalendarItem,
} from './calendar'

const item = (reference: string, dates: Partial<CalendarItem> = {}): CalendarItem => ({
  reference,
  site: 'Site ' + reference,
  client: 'Client',
  type: 'First survey',
  status: 'not_started',
  start: null,
  end: null,
  due: null,
  engineer: { id: 'e1', name: 'Alex Rowe' },
  contacts: [],
  ...dates,
})
// An entry as [key, first column, columns, lane].
const placed = (week: ReturnType<typeof layoutWeek>) =>
  week.entries.map((e) => [e.key, e.col, e.span, e.lane])

describe('periods', () => {
  it('starts a week on Monday and names a month or a week', () => {
    // 15 Nov 2026 is a Sunday: its week began on Monday the 9th.
    expect(weekStart('2026-11-15')).toBe('2026-11-09')
    expect(weekStart('2026-11-09')).toBe('2026-11-09')
    expect(periodLabel('month', '2026-11-01')).toBe('November 2026')
    expect(periodLabel('week', '2026-11-09')).toBe('9 – 15 Nov 2026')
    // A week across two months, and across two years, names both ends.
    expect(periodLabel('week', '2026-11-30')).toBe('30 Nov – 6 Dec 2026')
    expect(periodLabel('week', '2026-12-28')).toBe('28 Dec – 3 Jan 2027')
  })

  it('steps months across a year end, from any day of the month', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('lays a month out as six weeks from the Monday on or before its first day', () => {
    // November 2026 starts on a Sunday, so the grid starts six days earlier.
    const november = monthWeeks([], '2026-11-01')
    expect(november).toHaveLength(6)
    expect(november[0].days[0]).toBe('2026-10-26')
    expect(november[5].days[6]).toBe('2026-12-06')
    // June 2026 starts on a Monday: no days of May.
    expect(monthWeeks([], '2026-06-15')[0].days[0]).toBe('2026-06-01')
    // December's grid runs into the next year.
    expect(monthWeeks([], '2026-12-01')[5].days[6]).toBe('2027-01-10')
  })
})

describe('a week of entries', () => {
  it('draws a survey over a weekend as one bar in each week it touches', () => {
    // Friday 6 Nov to Tuesday 10 Nov.
    const survey = [item('A', { start: '2026-11-06', end: '2026-11-10' })]
    const first = layoutWeek(survey, '2026-11-02')
    expect(placed(first)).toEqual([['survey:A', 4, 3, 0]])
    expect(first.entries[0]).toMatchObject({ fromEarlier: false, toLater: true })
    const second = layoutWeek(survey, '2026-11-09')
    expect(placed(second)).toEqual([['survey:A', 0, 2, 0]])
    expect(second.entries[0]).toMatchObject({ fromEarlier: true, toLater: false })
    // The week after holds none of it.
    expect(layoutWeek(survey, '2026-11-16').entries).toEqual([])
  })

  it('puts entries that share a day in separate lanes, surveys first and long before short', () => {
    const week = layoutWeek(
      [
        item('A', { start: '2026-11-11', due: '2026-11-13' }),
        item('B', { start: '2026-11-10', end: '2026-11-12' }),
        item('C', { start: '2026-11-13' }),
        item('D', { due: '2026-11-11' }),
      ],
      '2026-11-09',
    )
    expect(placed(week)).toEqual([
      ['survey:B', 1, 3, 0],
      ['survey:A', 2, 1, 1],
      // Friday is free in the first lane, so C takes it.
      ['survey:C', 4, 1, 0],
      ['due:D', 2, 1, 2],
      ['due:A', 4, 1, 1],
    ])
    expect(week.lanes).toBe(3)
  })

  it('counts what does not fit a month day, and shows one kind when asked', () => {
    const day = { start: '2026-11-25', due: '2026-11-25' }
    const busy = [item('A', day), item('B', day), item('C', { start: '2026-11-23' })]
    const [, , , , week] = monthWeeks(busy, '2026-11-01')
    // Three lanes show on Wednesday; the fourth entry is counted.
    expect(week.entries.filter((e) => e.col === 2)).toHaveLength(3)
    expect(week.more).toEqual([0, 0, 1, 0, 0, 0, 0])
    expect(week.lanes).toBe(3)
    // A week view has no limit.
    expect(layoutWeek(busy, '2026-11-23').more).toEqual([0, 0, 0, 0, 0, 0, 0])

    expect(layoutWeek(busy, '2026-11-23', 'surveys').entries.map((e) => e.kind)).toEqual([
      'survey',
      'survey',
      'survey',
    ])
    expect(layoutWeek(busy, '2026-11-23', 'due').entries.map((e) => e.key)).toEqual([
      'due:A',
      'due:B',
    ])
  })
})

describe('report due dates', () => {
  const on = (due: string, status: CalendarItem['status'] = 'draft') =>
    dueOf({ due, status }, '2026-11-15')

  it('are late, soon within seven days, or on track, as the Report due cell counts', () => {
    expect(on('2026-11-10')).toEqual({ state: 'late', note: '5 days late' })
    expect(on('2026-11-14')).toEqual({ state: 'late', note: '1 day late' })
    expect(on('2026-11-15')).toEqual({ state: 'soon', note: 'today' })
    expect(on('2026-11-22')).toEqual({ state: 'soon', note: 'in 7 days' })
    expect(on('2026-11-23')).toEqual({ state: 'ok', note: 'in 8 days' })
    expect(dueOf({ due: null, status: 'draft' }, '2026-11-15')).toBeNull()
  })

  it('are never late once the report is finalised', () => {
    expect(on('2026-11-10', 'finalised')).toEqual({ state: 'done', note: 'finalised' })
  })
})

describe('the work list as calendar items', () => {
  const assessment = (reference: string, more: Partial<Assessment>) =>
    ({
      reference,
      client: 'Client',
      surveyType: 'Resurvey',
      siteVisitDate: '2026-11-03',
      reportDueDate: null,
      engineer: null,
      status: 'draft',
      site: { name: 'Site ' + reference },
      ...more,
    }) as Assessment

  it('leaves out archived assessments, and reads a last day on the first as one day', () => {
    const items = toItems([
      assessment('A', {
        siteVisitEndDate: '2026-11-05',
        siteContacts: [{ name: 'Mei', role: null }],
      }),
      assessment('B', { siteVisitEndDate: '2026-11-03' }),
      assessment('C', { status: 'archived' }),
    ])
    expect(items.map((i) => [i.reference, i.start, i.end])).toEqual([
      ['A', '2026-11-03', '2026-11-05'],
      ['B', '2026-11-03', null],
    ])
    expect(items[0].contacts).toEqual([{ name: 'Mei', role: null }])
    // An assessment from before site contacts has none.
    expect(items[1].contacts).toEqual([])
  })
})

describe('the phone list', () => {
  it('lists the days that hold something, a running survey on the first day shown', () => {
    const days = agenda(
      [
        // Began in October and still running on 1 Nov.
        item('A', { start: '2026-10-30', end: '2026-11-02', due: '2026-11-20' }),
        item('B', { start: '2026-11-20' }),
        item('C', { start: '2026-12-01', due: '2026-12-15' }),
      ],
      '2026-11-01',
      '2026-11-30',
    )
    expect(days.map((d) => [d.day, d.entries.map((e) => e.key)])).toEqual([
      ['2026-11-01', ['survey:A']],
      ['2026-11-20', ['survey:B', 'due:A']],
    ])
  })
})
