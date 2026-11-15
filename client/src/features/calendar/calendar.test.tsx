// CP-60: the Calendar screen on a fixed day (Sunday 15 Nov 2026), and its place in the app.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from '../../App'
import type { Assessment } from '../assessments/api'
import { signIn } from '../../test/session'
import { keptViews } from './keptView'
import { Calendar } from './screens/Calendar'

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // The month and filters one test leaves are not the next one's.
  keptViews.clear()
})

const ALEX = { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' }
const JIDE = { id: '6ab39017e45cf009e4507732', name: 'Jide Okafor' }
const TODAY = '2026-11-15'

const assessment = (
  reference: string,
  site: string,
  more: Partial<Assessment> = {},
): Assessment => ({
  id: 'id-' + reference,
  reference,
  client: 'Northgate Freight',
  clientId: 'c1',
  surveyType: 'First survey',
  siteVisitDate: null,
  siteVisitEndDate: null,
  reportDueDate: null,
  siteContacts: [],
  engineer: ALEX,
  status: 'draft',
  captureStartedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  site: {
    id: 's-' + reference,
    code: 'SITE-' + reference,
    name: site,
    address: null,
    jurisdiction: 'SG',
    facilityType: 'Office',
    removed: false,
    change: { allowed: true, reason: null, assessments: 1 },
  },
  ...more,
})

const WORK = [
  assessment('RPT-1', 'Tuas Hub', {
    siteVisitDate: '2026-11-03',
    siteVisitEndDate: '2026-11-04',
    reportDueDate: '2026-11-17',
    siteContacts: [{ name: 'Mei Lin Goh', role: 'Facilities manager' }],
  }),
  assessment('RPT-2', 'Jurong Store', {
    surveyType: 'Resurvey',
    siteVisitDate: '2026-10-27',
    reportDueDate: '2026-11-10',
    status: 'under_review',
  }),
  assessment('RPT-3', 'Senoko Plant', {
    surveyType: 'Follow-up visit',
    siteVisitDate: '2026-12-08',
    reportDueDate: '2026-12-22',
    status: 'not_started',
  }),
  assessment('RPT-4', 'Loyang Base', { status: 'not_started' }),
  assessment('RPT-5', 'Woodlands Depot', {
    siteVisitDate: '2026-11-18',
    reportDueDate: '2026-12-02',
    engineer: JIDE,
  }),
  assessment('RPT-6', 'Old Yard', { siteVisitDate: '2026-11-05', status: 'archived' }),
]

function show(props: Partial<Parameters<typeof Calendar>[0]> = {}) {
  const onOpen = vi.fn()
  const onStart = vi.fn()
  const onChanged = vi.fn()
  const view = render(
    <Calendar
      assessments={WORK}
      loading={false}
      failed={false}
      me={ALEX}
      team={false}
      onOpen={onOpen}
      onStart={onStart}
      onChanged={onChanged}
      today={TODAY}
      {...props}
    />,
  )
  return { onOpen, onStart, onChanged, ...view }
}
const period = () => screen.getByRole('status', { name: 'Period shown' }).textContent
const grid = () => document.querySelector<HTMLElement>('.cal-grid')!
const entries = () =>
  [...grid().querySelectorAll('.cal-chip')].map((chip) => chip.getAttribute('aria-label'))

it('shows the month: each survey as a bar, each report due date as a marker, not the archived', () => {
  show()
  expect(period()).toBe('November 2026')
  expect(entries()).toEqual([
    // The grid starts on Monday 26 Oct, so the end of October is in it.
    'Resurvey, Jurong Store, Northgate Freight, 27 Oct 2026',
    'First survey, Tuas Hub, Northgate Freight, 3 Nov 2026 to 4 Nov 2026',
    'Report due, Jurong Store, Northgate Freight, 10 Nov 2026, 5 days late',
    'First survey, Woodlands Depot, Northgate Freight, 18 Nov 2026',
    'Report due, Tuas Hub, Northgate Freight, 17 Nov 2026, in 2 days',
    'Report due, Woodlands Depot, Northgate Freight, 2 Dec 2026, in 17 days',
  ])
  // The first of the next month names it, and today is marked.
  expect(within(grid()).getByRole('button', { name: /^Tuesday 1 Dec 2026/ })).toHaveTextContent(
    '1 Dec',
  )
  expect(within(grid()).getByRole('button', { name: /^Sunday 15 Nov 2026, today/ })).toBeVisible()

  // Beside it: what is late, and what has no survey date.
  const late = screen.getByRole('region', { name: /Late reports/ })
  expect(within(late).getByRole('button', { name: /Jurong Store/ })).toHaveTextContent(
    '10 Nov 20265 days late',
  )
  const unscheduled = screen.getByRole('region', { name: /No survey date/ })
  expect(
    within(unscheduled).getByRole('button', { name: /^First survey, Loyang Base/ }),
  ).toBeVisible()
  // Archived work is not counted.
  expect(screen.getByText('5 assessments')).toBeVisible()
  expect(screen.getByRole('button', { name: '1 report late' })).toBeVisible()
})

it('steps by month or week, returns to today, and opens a week from its day', () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  expect(period()).toBe('December 2026')
  expect(entries()).toContain('Follow-up, Senoko Plant, Northgate Freight, 8 Dec 2026')
  fireEvent.click(screen.getByRole('button', { name: 'Today' }))
  expect(period()).toBe('November 2026')

  // The month holding today opens on today's week.
  fireEvent.click(screen.getByRole('radio', { name: 'Week' }))
  expect(period()).toBe('9 – 15 Nov 2026')
  expect(entries()).toEqual([
    'Report due, Jurong Store, Northgate Freight, 10 Nov 2026, 5 days late',
  ])
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
  expect(period()).toBe('2 – 8 Nov 2026')
  // Back in the month view, a day's date opens its week.
  fireEvent.click(screen.getByRole('radio', { name: 'Month' }))
  fireEvent.click(within(grid()).getByRole('button', { name: /^Wednesday 18 Nov 2026/ }))
  expect(period()).toBe('16 – 22 Nov 2026')
})

it('filters by what is shown and by assessment type, and the late count opens the late reports', () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: 'All dates' }))
  fireEvent.click(screen.getByRole('option', { name: 'Report due dates' }))
  expect(entries().every((name) => name!.startsWith('Report due'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'All dates: Report due dates' }))
  fireEvent.click(screen.getByRole('option', { name: 'All dates' }))

  fireEvent.click(screen.getByRole('button', { name: 'Assessment type' }))
  fireEvent.click(screen.getByRole('option', { name: 'Resurvey' }))
  expect(entries()).toEqual([
    'Resurvey, Jurong Store, Northgate Freight, 27 Oct 2026',
    'Report due, Jurong Store, Northgate Freight, 10 Nov 2026, 5 days late',
  ])
  expect(screen.getByText('1 assessment')).toBeVisible()
  // The side lists follow the filter.
  expect(screen.getByText('None without a survey date match.')).toBeVisible()

  // From another month, the footer's late count returns to the month of the oldest late report.
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  fireEvent.click(screen.getByRole('button', { name: '1 report late' }))
  expect(period()).toBe('November 2026')
  expect(screen.getByRole('button', { name: 'All dates: Report due dates' })).toBeVisible()
})

it('opens an entry on its details, and from there the assessment', () => {
  const { onOpen } = show()
  fireEvent.click(within(grid()).getByRole('button', { name: /^First survey, Tuas Hub/ }))
  const details = screen.getByRole('dialog', { name: 'Tuas Hub' })
  expect(details).toHaveTextContent('RPT-1')
  expect(details).toHaveTextContent('3 Nov 2026 to 4 Nov 2026')
  expect(details).toHaveTextContent('17 Nov 2026in 2 days')
  expect(details).toHaveTextContent('Mei Lin Goh, Facilities manager')
  // A reader's own list does not name the engineer on every entry.
  expect(within(details).queryByText('Engineer')).not.toBeInTheDocument()
  fireEvent.click(within(details).getByRole('button', { name: 'Open assessment' }))
  expect(onOpen).toHaveBeenCalledWith('RPT-1', 'Tuas Hub')
})

it('reschedules from an entry: refuses dates out of order, then saves all three and reloads', async () => {
  const saves: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    saves.push({ url, body: JSON.parse(String(init?.body)) })
    return Promise.resolve(new Response(null, { status: 204 }))
  })
  const { onChanged } = show()
  fireEvent.click(within(grid()).getByRole('button', { name: /^First survey, Tuas Hub/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
  const dialog = screen.getByRole('dialog', { name: 'Reschedule Tuas Hub' })
  const field = (name: string) => within(dialog).getByRole('textbox', { name })
  expect(field('Survey start')).toHaveValue('03/11/2026')
  expect(field('Survey end')).toHaveValue('04/11/2026')
  expect(field('Report due')).toHaveValue('17/11/2026')
  // Nothing changed yet, so there is nothing to save.
  expect(within(dialog).getByRole('button', { name: 'Save dates' })).toBeDisabled()

  fireEvent.change(field('Survey end'), { target: { value: '01/11/2026' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save dates' }))
  expect(
    within(dialog).getByText('Pick a date on or after 03/11/2026, the survey start.'),
  ).toBeVisible()
  expect(saves).toEqual([])

  fireEvent.change(field('Survey start'), { target: { value: '10/11/2026' } })
  fireEvent.change(field('Survey end'), { target: { value: '12/11/2026' } })
  fireEvent.change(field('Report due'), { target: { value: '24/11/2026' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save dates' }))
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(saves).toEqual([
    {
      url: '/api/assessments/RPT-1',
      body: {
        surveyType: 'First survey',
        siteVisitDate: '2026-11-10',
        siteVisitEndDate: '2026-11-12',
        reportDueDate: '2026-11-24',
      },
    },
  ])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('sets dates for an assessment with none, from the side list', async () => {
  const saves: unknown[] = []
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    saves.push(JSON.parse(String(init?.body)))
    return Promise.resolve(new Response(null, { status: 204 }))
  })
  const { onChanged } = show()
  fireEvent.click(screen.getByRole('button', { name: 'Set dates for Loyang Base' }))
  const dialog = screen.getByRole('dialog', { name: 'Reschedule Loyang Base' })
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Survey start' }), {
    target: { value: '20/11/2026' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save dates' }))
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
  // One day: no last day of its own, and the due date left empty stays cleared.
  expect(saves).toEqual([
    {
      surveyType: 'First survey',
      siteVisitDate: '2026-11-20',
      siteVisitEndDate: '',
      reportDueDate: '',
    },
  ])
})

it("shows a knowledge admin the team, read-only on another engineer's assessment", () => {
  show({ me: { id: 'admin', name: 'Sana Patel' }, team: true })
  expect(
    screen.getByText('Surveys and report due dates for every assessment across the team.'),
  ).toBeVisible()
  // Entries name their engineer, and the list can be narrowed to one.
  expect(entries()).toContain(
    'First survey, Woodlands Depot, Northgate Freight, 18 Nov 2026, Jide Okafor',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Engineer' }))
  fireEvent.click(screen.getByRole('option', { name: 'Jide Okafor' }))
  expect(entries().every((name) => name!.endsWith('Jide Okafor'))).toBe(true)

  fireEvent.click(within(grid()).getByRole('button', { name: /^First survey, Woodlands Depot/ }))
  const details = screen.getByRole('dialog', { name: 'Woodlands Depot' })
  expect(details).toHaveTextContent('EngineerJide Okafor')
  const reschedule = within(details).getByRole('button', { name: 'Reschedule' })
  expect(reschedule).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(reschedule)
  expect(screen.getByRole('tooltip')).toHaveTextContent(
    'Only the assigned engineer can change these dates.',
  )
  expect(screen.queryByRole('dialog', { name: /^Reschedule/ })).not.toBeInTheDocument()
  // Nor Set dates on someone else's assessment in the side list.
  fireEvent.click(screen.getByRole('button', { name: 'Engineer: Jide Okafor' }))
  fireEvent.click(screen.getByRole('option', { name: 'Any engineer' }))
  expect(screen.queryByRole('button', { name: /^Set dates for/ })).not.toBeInTheDocument()
})

it('starts a new assessment on a day, and counts what a full day hides', () => {
  const day = { siteVisitDate: '2026-11-25', reportDueDate: '2026-11-25' }
  const { onStart } = show({
    assessments: [
      assessment('RPT-1', 'Alpha', day),
      assessment('RPT-2', 'Beta', day),
      assessment('RPT-3', 'Gamma', day),
    ],
  })
  // Three of the day's six entries show; the rest are one press away, in its week.
  const more = within(grid()).getByRole('button', { name: /^3 more on 25 Nov 2026/ })
  expect(more).toHaveTextContent('+3 more')
  fireEvent.click(more)
  expect(period()).toBe('23 – 29 Nov 2026')
  expect(entries()).toHaveLength(6)

  fireEvent.click(screen.getByRole('button', { name: 'New assessment on 27 Nov 2026' }))
  expect(onStart).toHaveBeenCalledWith('form', '2026-11-27')
})

it('has no + on days for someone who may not create an assessment', () => {
  show({ onStart: undefined })
  expect(screen.queryByRole('button', { name: /^New assessment/ })).not.toBeInTheDocument()
})

it('moves between days with the arrow keys, one tab stop for the grid', () => {
  show()
  const day = (name: RegExp) => within(grid()).getByRole('button', { name })
  const today = day(/^Sunday 15 Nov 2026/)
  expect(today).toHaveAttribute('tabindex', '0')
  expect(day(/^Saturday 14 Nov 2026/)).toHaveAttribute('tabindex', '-1')
  today.focus()
  fireEvent.keyDown(today, { key: 'ArrowLeft' })
  expect(day(/^Saturday 14 Nov 2026/)).toHaveFocus()
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
  expect(day(/^Saturday 21 Nov 2026/)).toHaveFocus()
  expect(day(/^Saturday 21 Nov 2026/)).toHaveAttribute('tabindex', '0')
})

it('finds the same month and filters on coming back', () => {
  const first = show()
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  fireEvent.click(screen.getByRole('button', { name: 'Assessment type' }))
  fireEvent.click(screen.getByRole('option', { name: 'Follow-up' }))
  first.unmount()
  show()
  expect(period()).toBe('December 2026')
  expect(screen.getByRole('button', { name: 'Assessment type: Follow-up' })).toBeVisible()
})

it('lists the month by day on a phone, and says when the list could not be read', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 767px)',
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  const { unmount } = show()
  expect(document.querySelector('.cal-grid')).not.toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: 'Week' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
    'Tue 3 Nov',
    'Tue 10 Nov',
    'Tue 17 Nov',
    'Wed 18 Nov',
    'Late reports1',
    'No survey date1',
  ])
  const day = screen.getByRole('region', { name: 'Tuesday 3 Nov 2026' })
  expect(within(day).getByRole('button', { name: /^First survey, Tuas Hub/ })).toHaveTextContent(
    '2 days',
  )
  unmount()

  show({ assessments: [], failed: true })
  expect(screen.getByText('Your calendar could not be loaded')).toBeVisible()
})

it('opens from the sidebar, and an assessment opened from it goes back to it', async () => {
  vi.stubGlobal('fetch', (url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(url === '/api/assessments' ? WORK : []), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  // The app's own "today" is the real one: step to the month the survey is in.
  vi.useFakeTimers({ now: new Date('2026-11-15T09:00:00'), toFake: ['Date'] })
  try {
    render(<App />)
    await signIn()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Calendar' }))[0])
    await screen.findByRole('heading', { name: 'Calendar', level: 1 })
    expect(window.location.pathname).toBe('/calendar')
    fireEvent.click(await screen.findByRole('button', { name: /^First survey, Tuas Hub/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open assessment' }))
    await screen.findByRole('tab', { name: /Overview/ })
    expect(window.location.pathname).toBe('/assessment')
    fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }))
    await screen.findByRole('heading', { name: 'Calendar', level: 1 })
    expect(window.location.pathname).toBe('/calendar')
  } finally {
    vi.useRealTimers()
  }
})
