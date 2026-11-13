// MarshBot's cards on their own (AS-06 round 7): the outline's note and attention rules, no quote
// on a row, and every stage in Time in Each Stage with a text alternative. Cards are drawn
// straight inside a stand-in MarshBot context: no gateway, no network.
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarshBotContext } from './context'
import { CardRow } from './components/thread/CardRow'
import { OutlineCard } from './components/thread/OutlineCard'
import { RowsCard } from './components/thread/RowsCard'
import { StageTimeCard } from './components/thread/StageTimeCard'
import { recordingRow, thread } from './testThreads'
import type { Card, OutlineItem, OutlineState } from './types'

afterEach(cleanup)

const bot = { thread: thread(), openLink: vi.fn(), retry: vi.fn(), busy: new Set<string>() }
const inBot = (ui: ReactNode) =>
  render(<MarshBotContext.Provider value={bot}>{ui}</MarshBotContext.Provider>)

const item = (no: string, state: OutlineState, note: string | null = null): OutlineItem => ({
  no,
  title: `Section ${no}`,
  state,
  note,
  link: null,
})
const outline = (items: OutlineItem[]): Extract<Card, { type: 'outline' }> => ({
  type: 'outline',
  id: 'sections',
  title: 'Sections',
  lead: 'Lead',
  items,
  next: null,
  key: [
    { state: 'ok', label: 'Ready' },
    { state: 'new', label: 'Not Drafted' },
  ],
  cta: null,
})
const attn = (no: string) => screen.getByText(`Section ${no}`).closest('li')?.dataset.attn

describe('outline card', () => {
  it('keeps a "Waits" note and drops notes that repeat the state', () => {
    inBot(
      <OutlineCard
        card={outline([
          item('1', 'new', 'Waits on 4'),
          item('2', 'figures', 'Scores'),
          item('3', 'question', '3 questions'),
          item('4', 'wait', '4 findings left'),
        ])}
      />,
    )
    expect(screen.getByText('Waits on 4')).toBeTruthy()
    for (const gone of ['Scores', '3 questions', '4 findings left']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
  })

  it('washes the rows that need the engineer, and a lone undrafted row nothing waits on', () => {
    inBot(
      <OutlineCard
        card={outline([
          item('1', 'question'),
          item('2', 'figures'),
          item('3', 'wait'),
          item('4', 'bad'),
          item('5', 'ok'),
          item('6', 'new'),
        ])}
      />,
    )
    expect(['1', '2', '3'].map(attn)).toEqual(['amber', 'amber', 'amber'])
    expect(attn('4')).toBe('red')
    expect(attn('5')).toBeUndefined()
    // The only undrafted row, with no note: it is the next thing to do.
    expect(attn('6')).toBe('amber')
  })

  it('leaves undrafted rows plain when there are several, or when one waits on others', () => {
    const { unmount } = inBot(<OutlineCard card={outline([item('1', 'new'), item('2', 'new')])} />)
    expect([attn('1'), attn('2')]).toEqual([undefined, undefined])
    unmount()
    inBot(<OutlineCard card={outline([item('1', 'new', 'Waits on 4'), item('2', 'ok')])} />)
    expect(attn('1')).toBeUndefined()
  })

  it('puts the key in the free cell of the right column, or under the list when none is free', () => {
    const odd = inBot(
      <OutlineCard card={outline([item('1', 'ok'), item('2', 'ok'), item('3', 'ok')])} />,
    )
    expect(odd.container.querySelector('.mbt-ol-cols li.mbt-ol-keycell')).toBeTruthy()
    odd.unmount()
    const even = inBot(<OutlineCard card={outline([item('1', 'ok'), item('2', 'ok')])} />)
    expect(even.container.querySelector('.mbt-ol-keycell')).toBeNull()
    expect(even.container.querySelector('.mbt-ol-cols + .mbt-ol-key')).toBeTruthy()
    even.unmount()
    // One state needs no key (round 8, item 25): the rows still take its word.
    const one = inBot(
      <OutlineCard
        card={{ ...outline([item('1', 'ok')]), key: [{ state: 'ok', label: 'Reviewed' }] }}
      />,
    )
    expect(one.container.querySelector('.mbt-ol-key')).toBeNull()
    expect(one.container.textContent).toContain('Reviewed')
    one.unmount()
    // A key of 4 states would wrap to 2 lines in the free cell: it goes under the list instead.
    const four = inBot(
      <OutlineCard
        card={{
          ...outline([item('1', 'ok'), item('2', 'ok'), item('3', 'ok')]),
          key: (['ok', 'wait', 'question', 'new'] as const).map((state) => ({
            state,
            label: state,
          })),
        }}
      />,
    )
    expect(four.container.querySelector('.mbt-ol-keycell')).toBeNull()
    expect(four.container.querySelector('.mbt-ol-cols + .mbt-ol-key')).toBeTruthy()
  })
})

describe('card row', () => {
  it('does not draw a saved quote', () => {
    inBot(<CardRow row={{ ...recordingRow, quote: 'Pallets stacked three high' }} />)
    expect(screen.getByText('Loading Bay 2')).toBeTruthy()
    expect(screen.queryByText(/Pallets stacked/)).toBeNull()
  })
})

describe('rows card', () => {
  it('draws nothing with no rows and no ticks (an old saved "Export again" answer)', () => {
    const { container } = inBot(
      <RowsCard
        card={{
          type: 'rows',
          id: 'export',
          title: 'Export',
          note: null,
          rows: [],
          ticks: [],
          cta: { label: 'Open Export', link: { tab: 'export' } },
        }}
      />,
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('time in each stage', () => {
  it('shows all 8 stages in order, the ones not reached with a dash, each with a text alternative', () => {
    const { container } = render(
      <StageTimeCard
        card={{
          type: 'stage-time',
          id: 'st',
          title: 'Time in Each Stage',
          note: '13 days so far',
          spans: [
            { label: 'Setup', days: 7, now: false },
            { label: 'Prepare', days: 6, now: true },
          ],
        }}
      />,
    )
    expect(container.querySelectorAll('.mbt-time li')).toHaveLength(8)
    expect([...container.querySelectorAll('.mbt-time-name')].map((n) => n.textContent)).toEqual([
      'Setup',
      'Prepare',
      'Capture',
      'Ready for generation',
      'Generate',
      'Review',
      'Ready to export',
      'Exported',
    ])
    expect(screen.getByText('Setup, 7 days')).toBeTruthy()
    expect(screen.getByText('Prepare, 6 days, now')).toBeTruthy()
    expect(screen.getByText('Exported, not reached')).toBeTruthy()
    expect(container.querySelector('li[data-reached="false"] .mbt-time-days')?.textContent).toBe(
      '–',
    )
    expect(container.querySelector('li[data-now] em')?.textContent).toBe('Now')
  })

  it('says a skipped stage was skipped, not "0d"', () => {
    const { container } = render(
      <StageTimeCard
        card={{
          type: 'stage-time',
          id: 'st',
          title: 'Time in Each Stage',
          note: '3 days so far',
          spans: [
            { label: 'Setup', days: 3, now: false },
            { label: 'Prepare', days: 0, now: false, skipped: true },
            { label: 'Capture', days: 0, now: true },
          ],
        }}
      />,
    )
    const [, prepare, capture] = container.querySelectorAll<HTMLElement>('.mbt-time li')
    expect(prepare.querySelector('.mbt-time-days')?.textContent).toBe('Skipped')
    expect(prepare.querySelector('.mbt-time-bar i')).toBeNull()
    expect(screen.getByText('Prepare, skipped')).toBeTruthy()
    // A stage done on the same day still reads 0d.
    expect(capture.querySelector('.mbt-time-days')?.textContent).toBe('0dNow')
  })

  it('shows a stage jumped over as passed in 0 days, and only later ones as not reached', () => {
    const { container } = render(
      <StageTimeCard
        card={{
          type: 'stage-time',
          id: 'st',
          title: 'Time in Each Stage',
          note: '10 days so far',
          spans: [
            { label: 'Setup', days: 7, now: false },
            { label: 'Capture', days: 3, now: true },
          ],
        }}
      />,
    )
    const prepare = container.querySelectorAll<HTMLElement>('.mbt-time li')[1]
    expect(prepare.dataset.reached).toBe('true')
    expect(prepare.querySelector('.mbt-time-days')?.textContent).toBe('0d')
    expect(prepare.querySelector('.mbt-time-bar i')).toBeNull()
    expect(screen.getByText('Prepare, 0 days')).toBeTruthy()
    expect(screen.getByText('Ready for generation, not reached')).toBeTruthy()
  })
})
