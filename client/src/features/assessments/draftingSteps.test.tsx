// The Generation tab (GN-13, test seam 4): each checkpoint from its board's fixture, the
// flagged rows, starting a drafting run, a pushed `drafting` event, the links to Review and
// Observations, and the section-list wording. The gateway is a stubbed fetch and the push
// stream a stand-in EventSource; no network, no AI.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as boards from './generation/fixtures'
import type { GenerationDto } from './generation/types'
import { headerWords, sectionList } from './generation/words'
import { DraftingSteps } from './screens/DraftingSteps'

const REF = 'RPT-2026-0039'
const BASE = `/api/assessments/${REF}/generation`

// The stand-in push stream: a test fires `drafting` on the open one.
class FakeEventSource {
  static open: FakeEventSource[] = []
  static CLOSED = 2
  readyState = 1
  onerror: (() => void) | null = null
  listeners: Record<string, (() => void)[]> = {}
  url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.open.push(this)
  }
  addEventListener(type: string, fn: () => void) {
    ;(this.listeners[type] ??= []).push(fn)
  }
  close() {
    FakeEventSource.open = FakeEventSource.open.filter((s) => s !== this)
  }
  emit(type: string) {
    this.listeners[type]?.forEach((fn) => fn())
  }
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// The stand-in gateway: GET answers `current`; POST /run answers `afterRun`.
let current: GenerationDto
let posts: string[]
let gets: number
function serve(first: GenerationDto, afterRun?: GenerationDto) {
  current = first
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(url)
      if (afterRun) current = afterRun
      return json(202, current)
    }
    gets++
    return url === BASE ? json(200, current) : json(404, { error: 'Not found' })
  })
}

function show(first: GenerationDto, afterRun?: GenerationDto) {
  serve(first, afterRun)
  const links = { onReview: vi.fn(), onOpenSection: vi.fn(), onObservations: vi.fn() }
  render(<DraftingSteps reference={REF} {...links} />)
  return links
}

// The header card, found from its title.
const header = async () =>
  (await screen.findByRole('heading', { level: 2 })).closest('.ds-checkpoint') as HTMLElement
const step = (n: number) => screen.getByRole('region', { name: new RegExp(`^Step ${n}:`) })
const row = (n: number, name: string) =>
  within(step(n)).getByText(name).closest('.ds-srow') as HTMLElement

beforeEach(() => {
  posts = []
  gets = 0
  FakeEventSource.open = []
  vi.stubGlobal('EventSource', FakeEventSource)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the checkpoint header', () => {
  // [board, title, line, the one control (or null), drafted of 11]
  const cases: [string, GenerationDto, string, string, string | null, number][] = [
    [
      '01',
      boards.checkReady,
      'Ready to draft from observations',
      'Each of the 8 sections has at least 1 observation. Drafting runs in the background and takes a few minutes.',
      'Draft 8 sections',
      0,
    ],
    [
      '02',
      boards.draftingFromObservations,
      'Drafting 8 sections',
      "Drafting takes a few minutes, so you can leave this page and the bell will tell you when it's done.",
      null,
      3,
    ],
    [
      '03',
      boards.inputNeeded,
      'Your input is needed',
      'Accept at least 1 OFI and enter the figures for Sections 4 and 5. The last 3 sections are drafted from them.',
      'Open Review',
      8,
    ],
    [
      '04',
      boards.readyFromInput,
      'Ready to draft from your input',
      'Section 7 is also redrafted, because its observations changed after it was drafted.',
      'Draft 4 sections',
      8,
    ],
    [
      '05',
      boards.draftingFromInput,
      'Drafting 4 sections',
      'Drafting takes a few minutes, and Section 2 is drafted last because it summarises the other sections.',
      null,
      8,
    ],
    [
      '06',
      boards.reportDrafted,
      'Report drafted',
      'All 11 sections are drafted and ready for you to review before you export the report.',
      'Open Review',
      11,
    ],
    [
      '07',
      boards.noObservations,
      '2 sections need observations',
      'Add at least 1 observation to Sections 10 and 11, then you can start drafting.',
      'Open Observations',
      0,
    ],
    [
      '08',
      boards.transcribing,
      'Transcribing 2 recordings',
      'You can start drafting once they finish, so their observations are included.',
      'Draft 8 sections',
      0,
    ],
    [
      '09',
      boards.sectionNotDrafted,
      'Section 9 was not drafted',
      'Drafting failed 3 times, but the other 7 sections are drafted and ready in Review.',
      'Try again',
      7,
    ],
    [
      '10',
      boards.outOfDate,
      '2 sections are out of date',
      "Section 7's observations changed, so Section 2 needs redrafting too. Redrafting keeps the findings you accepted.",
      'Redraft 2 sections',
      11,
    ],
  ]

  it.each(cases)('board %s: title, line, one control and the drafted count', async (...c) => {
    const [, dto, title, line, control, drafted] = c
    show(dto)
    const card = await header()
    expect(within(card).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(card).getByText(line)).toBeInTheDocument()
    const buttons = within(card).queryAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(control ? [control] : [])
    expect(card).toHaveTextContent(`${drafted} of 11 drafted`)
    // The three steps are always all there.
    expect(screen.getAllByRole('region', { name: /^Step \d:/ })).toHaveLength(3)
  })

  it('greys the draft button while recordings are transcribing (board 08)', async () => {
    show(boards.transcribing)
    const card = await header()
    expect(within(card).getByRole('button', { name: 'Draft 8 sections' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('shows an admin View only, and no button, where drafting would start (board 11)', async () => {
    show(boards.adminViewOnly)
    const card = await header()
    expect(
      within(card).getByText(
        'Each of the 8 sections has at least 1 observation. Only the assigned engineer can start drafting.',
      ),
    ).toBeInTheDocument()
    expect(within(card).getByText('View only')).toBeInTheDocument()
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
  })
})

describe('the step cards', () => {
  it('counts a running step and marks each section (board 02)', async () => {
    show(boards.draftingFromObservations)
    await header()
    expect(step(1)).toHaveTextContent('3of 8')
    expect(within(row(1, 'Fire Protection')).getByRole('img', { name: 'Drafting' })).toBeVisible()
    expect(within(row(1, 'Construction')).getByRole('img', { name: 'Drafted' })).toBeVisible()
    expect(
      within(row(1, 'Security')).getByRole('img', { name: 'Waiting to be drafted' }),
    ).toBeVisible()
  })

  it('shows each section’s observation count before step 1 (board 01)', async () => {
    show(boards.checkReady)
    await header()
    expect(
      within(row(1, 'Opportunities for Improvement')).getByLabelText('12 observations'),
    ).toBeVisible()
    // Step 3's sections have no mark until drafted.
    expect(within(row(3, 'Executive Summary')).queryByRole('img')).toBeNull()
  })
})

describe('flagged rows', () => {
  it('flags a section with no observations: amber 0 and the camera, no words (board 07)', async () => {
    show(boards.noObservations)
    await header()
    const security = row(1, 'Security')
    expect(security).toHaveAttribute('data-flag', 'warn')
    expect(within(security).getByLabelText('0 observations')).toBeVisible()
    expect(security.querySelector('.ds-srow-reason')).toBeNull()
    expect(row(1, 'Business Interruption')).not.toHaveAttribute('data-flag')
  })

  it('flags an out-of-date section with its reason (board 10)', async () => {
    show(boards.outOfDate)
    await header()
    const construction = row(1, 'Construction')
    expect(construction).toHaveAttribute('data-flag', 'warn')
    expect(within(construction).getByText('Observations changed')).toBeVisible()
    expect(
      within(row(3, 'Executive Summary')).getByText('Needs redrafting because Section 7 changed'),
    ).toBeVisible()
  })

  it('flags a failed section in red with its attempts (board 09)', async () => {
    show(boards.sectionNotDrafted)
    await header()
    const fire = row(1, 'Fire Protection')
    expect(fire).toHaveAttribute('data-flag', 'bad')
    expect(fire).toHaveTextContent('Drafting failed after 3 attempts')
    expect(step(1)).toHaveTextContent('7of 8')
  })
})

describe('starting and following a drafting run', () => {
  it('posts to /generation/run and shows the state it returns at once', async () => {
    show(boards.checkReady, boards.draftingFromObservations)
    fireEvent.click(within(await header()).getByRole('button', { name: 'Draft 8 sections' }))
    expect(await screen.findByRole('heading', { name: 'Drafting 8 sections' })).toBeInTheDocument()
    expect(posts).toEqual([`${BASE}/run`])
  })

  it('reads the state again when the gateway pushes `drafting`', async () => {
    show(boards.draftingFromObservations)
    await screen.findByRole('heading', { name: 'Drafting 8 sections' })
    const before = gets
    current = boards.inputNeeded
    act(() => FakeEventSource.open[0].emit('drafting'))
    expect(await screen.findByRole('heading', { name: 'Your input is needed' })).toBeInTheDocument()
    expect(gets).toBe(before + 1)
    expect(posts).toEqual([])
  })

  // `brief` is pushed when the engineer's input changes: a recording finished, an OFI accepted.
  it('reads the state again when the gateway pushes `brief`', async () => {
    show(boards.transcribing)
    await screen.findByRole('heading', { name: 'Transcribing 2 recordings' })
    const before = gets
    current = boards.checkReady
    act(() => FakeEventSource.open[0].emit('brief'))
    expect(
      await screen.findByRole('heading', { name: 'Ready to draft from observations' }),
    ).toBeInTheDocument()
    expect(gets).toBe(before + 1)
  })

  it('reads again when the stream first connects, so a push sent before it opened is not missed', async () => {
    show(boards.draftingFromObservations)
    await screen.findByRole('heading', { name: 'Drafting 8 sections' })
    const before = gets
    current = boards.inputNeeded
    act(() => FakeEventSource.open[0].emit('open'))
    expect(await screen.findByRole('heading', { name: 'Your input is needed' })).toBeInTheDocument()
    expect(gets).toBe(before + 1)
  })

  it('ignores an older reply that lands after a newer one', async () => {
    // The first read hangs until released; the read after the push answers at once.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let reads = 0
    vi.stubGlobal('fetch', async () => {
      reads++
      if (reads === 1) {
        await held
        return json(200, boards.draftingFromObservations)
      }
      return json(200, boards.inputNeeded)
    })
    render(
      <DraftingSteps
        reference={REF}
        onReview={vi.fn()}
        onOpenSection={vi.fn()}
        onObservations={vi.fn()}
      />,
    )
    act(() => FakeEventSource.open[0].emit('drafting'))
    expect(await screen.findByRole('heading', { name: 'Your input is needed' })).toBeInTheDocument()
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByRole('heading', { name: 'Your input is needed' })).toBeInTheDocument()
  })
})

describe('where Generation sends the engineer', () => {
  it('opens a task’s section in Review; a done task is not a link (board 03)', async () => {
    const links = show(boards.inputNeeded)
    await header()
    fireEvent.click(within(step(2)).getByRole('button', { name: /Enter the scores/ }))
    expect(links.onOpenSection).toHaveBeenCalledWith('4')
    expect(within(step(2)).queryByRole('button', { name: /Accept at least 1 OFI/ })).toBeNull()
    fireEvent.click(within(await header()).getByRole('button', { name: 'Open Review' }))
    expect(links.onReview).toHaveBeenCalled()
  })

  it('opens the Observations tab (board 07)', async () => {
    const links = show(boards.noObservations)
    fireEvent.click(within(await header()).getByRole('button', { name: 'Open Observations' }))
    expect(links.onObservations).toHaveBeenCalled()
  })
})

describe('the words', () => {
  // The gateway's rule (server/src/services/generation/words.ts): number order; ranges only
  // when every run reads well as one.
  it.each([
    [['3'], 'Section 3'],
    [['4', '5'], 'Sections 4 and 5'],
    [['9', '11'], 'Sections 9 and 11'],
    [['3', '6', '7', '8', '9', '10', '11', '12'], 'Section 3 and Sections 6 to 12'],
    [['6', '7', '8', '9', '10', '11', '12'], 'Sections 6 to 12'],
    [['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], 'Sections 3 to 12'],
    [['2', '4', '5'], 'Sections 2, 4 and 5'],
    [['7', '2'], 'Sections 2 and 7'],
    [['4', '5', '7'], 'Sections 4, 5 and 7'],
    [['3', '6', '8', '9', '11', '12'], 'Sections 3, 6, 8, 9, 11 and 12'],
    [['6', '7', '8', '10', '11', '12'], 'Sections 6 to 8 and Sections 10 to 12'],
  ])('writes %j as "%s"', (ids, words) => {
    expect(sectionList(ids)).toBe(words)
  })

  // The three cases with no board, worded in the same voice.
  it('says what step 3 drafts when nothing is out of date', () => {
    const ready = {
      ...boards.readyFromInput,
      checkpoint: { kind: 'ready', step: 3, parts: ['4', '5', '2'] },
      parts: boards.inputNeeded.parts,
    } satisfies GenerationDto
    expect(headerWords(ready).line).toBe(
      'Your input is in, so Sections 4 and 5 can be drafted, then Section 2.',
    )
  })

  it('names every section that failed', () => {
    const two = {
      ...boards.sectionNotDrafted,
      checkpoint: { kind: 'failed', failed: ['9', '11'], parts: ['9', '11'] },
      parts: boards.sectionNotDrafted.parts.map((p) =>
        p.id === '11' ? { ...p, drafted: false, job: 'failed' as const, attempts: 3 } : p,
      ),
    } satisfies GenerationDto
    expect(headerWords(two).title).toBe('Sections 9 and 11 were not drafted')
    expect(headerWords(two).line).toBe(
      'Each failed 3 times, but the other 6 sections are drafted and ready in Review.',
    )
  })

  it('counts a failure in step 3 against step 3’s sections', () => {
    const failed = {
      ...boards.draftingFromInput,
      checkpoint: { kind: 'failed', failed: ['4'], parts: ['4'] },
      parts: boards.reportDrafted.parts.map((p) =>
        p.id === '4' ? { ...p, drafted: false, job: 'failed' as const, attempts: 3 } : p,
      ),
    } satisfies GenerationDto
    expect(headerWords(failed).title).toBe('Section 4 was not drafted')
    expect(headerWords(failed).line).toBe(
      'Drafting failed 3 times, but the other 2 sections are drafted and ready in Review.',
    )
  })

  // What a real run leaves: Section 4 failed, Section 5 drafted, Section 2 still waiting.
  it('names the one other section a failed step 3 run did draft', () => {
    const failed = {
      ...boards.draftingFromInput,
      checkpoint: { kind: 'failed', failed: ['4'], parts: ['4', '2'] },
      parts: boards.reportDrafted.parts.map((p) =>
        p.id === '4'
          ? { ...p, drafted: false, job: 'failed' as const, attempts: 3 }
          : p.id === '2'
            ? { ...p, drafted: false }
            : p,
      ),
    } satisfies GenerationDto
    expect(headerWords(failed).line).toBe(
      'Drafting failed 3 times, but Section 5 is drafted and ready in Review.',
    )
  })
})

describe('review fixes', () => {
  // Phones (767 px and under): useIsPhone reads this media query.
  const asPhone = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

  // Feedback round 2: Section 7 redrafted with step 3 has one row, in step 1 (as board 10).
  it('keeps an out-of-date section in step 1 only, and counts step 3’s own rows', async () => {
    show(boards.readyFromInput)
    await header()
    expect(row(1, 'Construction')).toHaveAttribute('data-flag', 'warn')
    expect(within(step(3)).queryByText('Construction')).toBeNull()
    expect(step(3)).toHaveTextContent('Sections 4 and 5, then Section 2')
    cleanup()
    show(boards.draftingFromInput)
    await header()
    expect(step(3)).toHaveTextContent('0of 3')
    expect(step(1)).not.toHaveTextContent(/of 8/)
  })

  it('opens step 1 on a phone while it holds the out-of-date section', async () => {
    asPhone()
    show(boards.readyFromInput)
    await header()
    expect(within(row(1, 'Construction')).getByText('Observations changed')).toBeVisible()
  })

  it('counts a run on a card only when all its parts are that card’s rows', async () => {
    // Sections 7 and 2 redrafted after everything was drafted: 7 is step 1's row, 2 is step 3's.
    show({
      ...boards.outOfDate,
      checkpoint: { kind: 'drafting', step: 3, parts: ['7', '2'], done: 0 },
    })
    await header()
    expect(step(1)).not.toHaveTextContent(/of 2/)
    expect(step(3)).not.toHaveTextContent(/of 2/)
    expect(step(3)).toHaveAttribute('aria-busy', 'true')
  })

  it('puts a failed section’s reason on its red mark', async () => {
    show(boards.sectionNotDrafted)
    await header()
    const mark = within(row(1, 'Fire Protection')).getByRole('img', {
      name: 'Not drafted: The model did not answer.',
    })
    fireEvent.mouseEnter(mark.parentElement!)
    expect(within(row(1, 'Fire Protection')).getByRole('tooltip')).toHaveTextContent(
      'The model did not answer.',
    )
    // The row itself keeps board 09's one short line.
    expect(row(1, 'Fire Protection').querySelector('.ds-srow-reason')).toHaveTextContent(
      'Drafting failed after 3 attempts',
    )
  })

  it('writes large observation counts with a thousands separator', async () => {
    show({
      ...boards.checkReady,
      parts: boards.checkReady.parts.map((p) => (p.id === '3' ? { ...p, observations: 1284 } : p)),
    })
    await header()
    expect(
      within(row(1, 'Opportunities for Improvement')).getByLabelText('1,284 observations'),
    ).toHaveTextContent('1,284')
  })

  it('uses the shorter header lines on a phone (boards 12 and 13)', async () => {
    asPhone()
    show(boards.checkReady)
    expect(
      within(await header()).getByText(
        'Each of the 8 sections has at least 1 observation. Drafting takes a few minutes.',
      ),
    ).toBeInTheDocument()
    cleanup()
    show(boards.draftingFromObservations)
    expect(
      within(await header()).getByText(
        "Drafting takes a few minutes, and the bell will tell you when it's done.",
      ),
    ).toBeInTheDocument()
  })

  it('keeps focus on a phone’s step once it opens', async () => {
    asPhone()
    show(boards.inputNeeded)
    await header()
    const fold = within(step(1)).getByRole('button', { name: /Draft from observations/ })
    fold.focus()
    fireEvent.click(fold)
    expect(within(step(1)).queryByRole('button', { name: /Draft from observations/ })).toBeNull()
    expect(step(1).contains(document.activeElement)).toBe(true)
  })

  it('words the checkpoint for an admin, with tasks that are not theirs to open', async () => {
    show({ ...boards.inputNeeded, canStart: false })
    const card = await header()
    expect(
      within(card).getByRole('heading', { name: "Waiting for the engineer's input" }),
    ).toBeInTheDocument()
    expect(card).not.toHaveTextContent(/your input/i)
    expect(within(step(2)).queryAllByRole('button')).toHaveLength(0)
    expect(step(2).querySelector('[data-active]')).toBeNull()
    cleanup()

    show({ ...boards.outOfDate, canStart: false })
    const outOfDate = await header()
    expect(outOfDate).toHaveTextContent(
      "Section 7's observations changed, so Section 2 needs redrafting too. Only the assigned engineer can start drafting.",
    )
    expect(outOfDate).not.toHaveTextContent(/you accepted/)
  })
})
