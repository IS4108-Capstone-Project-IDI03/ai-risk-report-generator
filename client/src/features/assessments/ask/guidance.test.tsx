import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AskAnswer, AskConversation, GapLink, SectionGap } from './api'
import { AskPanel, type AskGuidanceTarget } from './AskPanel'
import { useAsk } from './useAsk'

// AS-08: writing guidance for a section, asked from two buttons in the Ask
// tab. "What should this section cover?" is answered like a question, citing
// the report template's parts; a cited part goes to its place in the section.
// "What is missing from this section?" lists the gateway's gaps, what blocks the
// export first, each with Go to section or Go to observation. The gateway is a
// stubbed fetch.

beforeAll(() => {
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
})

const REF = 'RPT-2026-0707'
const ASK = `/api/assessments/${REF}/ask`
const SCOPE = {
  observations: 3,
  standards: [],
  standardsFrom: 'applicable',
  jurisdiction: 'SG',
  facilityType: 'Warehouse',
  pastReports: 0,
}
const CONVERSATION: AskConversation = {
  id: 'c1',
  title: 'What is missing from 7. Construction?',
  startedAt: '2026-11-24T06:00:00.000Z',
  lastAskedAt: '2026-11-24T06:00:00.000Z',
  questions: 1,
}
const SEVEN = { sectionId: '7', label: '7. Construction' }

const GAPS: SectionGap[] = [
  {
    kind: 'pending_findings',
    fact: 'Section 7 has 2 findings waiting for a decision.',
    blocksExport: true,
    link: { to: 'section', sectionId: '7', finding: '0.0' },
  },
  {
    kind: 'table',
    fact: "Section 7's Construction Table reads Not entered.",
    blocksExport: false,
    link: { to: 'section', sectionId: '7', subsection: 1 },
  },
  {
    kind: 'observation',
    fact: "The observation at Pump room is tagged Construction but is still to check, so Section 7's draft leaves it out.",
    blocksExport: false,
    link: { to: 'observation', observationId: 'o3' },
  },
  {
    kind: 'category',
    fact: 'Section 7 has no observation tagged Construction.',
    blocksExport: false,
    link: { to: 'observation', observationId: null },
  },
]
const answer = (over: Partial<AskAnswer>): AskAnswer => ({
  id: 'q1',
  question: 'What is missing from 7. Construction?',
  passage: null,
  askedAt: '2026-11-24T06:00:00.000Z',
  status: 'complete',
  statements: [],
  missing: [],
  passages: [],
  observations: [],
  confidence: null,
  error: null,
  ...over,
})
const MISSING = answer({
  guidance: { kind: 'missing', ...SEVEN },
  gaps: GAPS,
})
const PART = {
  id: 'T:7.1',
  sectionId: '7',
  label: '7. Construction',
  subsection: 1,
  heading: 'Construction Table',
  kind: 'table' as const,
  fields: [],
  text: 'Construction Table: a table completed from measured values.',
}
const COVERS = {
  text: 'Construction Table is a table completed from measured values.',
  citations: [
    { ref: 'T:7.1', kind: 'template' as const, quote: null, verified: true, described: false },
  ],
}
const COVER = answer({
  id: 'q2',
  question: 'What should 7. Construction cover?',
  guidance: { kind: 'cover', ...SEVEN },
  statements: [COVERS],
  template: [PART],
  confidence: 'high',
})

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const sse = (...events: object[]) =>
  Promise.resolve(
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  )

type Call = { method: string; url: string; body?: Record<string, unknown> }
function gateway({
  archived = false,
  questions = [] as AskAnswer[],
  asked = (body: Record<string, unknown>) => {
    const guide = body.guide as { kind: string }
    const saved = guide.kind === 'cover' ? COVER : MISSING
    return sse(
      {
        type: 'question',
        id: saved.id,
        question: saved.question,
        askedAt: saved.askedAt,
        conversation: CONVERSATION,
      },
      ...(guide.kind === 'cover'
        ? [
            { type: 'step', step: 'generate' },
            { type: 'statement', ...COVERS, template: [PART] },
          ]
        : []),
      { type: 'result', answer: saved },
    )
  },
} = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, url, body })
    if (url === ASK && method === 'POST') return asked(body!)
    if (url === ASK)
      return json(200, {
        scope: SCOPE,
        archived,
        conversations: questions.length ? [CONVERSATION] : [],
        conversation: questions.length ? CONVERSATION : null,
        questions,
      })
    return json(200, {})
  })
  return calls
}

function Tab({
  target = SEVEN,
  onGo = () => {},
  onCite = () => {},
}: {
  target?: AskGuidanceTarget['target']
  onGo?: (link: GapLink) => void
  onCite?: (ref: string) => void
}) {
  const ask = useAsk(REF, true)
  return (
    <AskPanel ask={ask} current={null} onCite={(ref) => onCite(ref)} guidance={{ target, onGo }} />
  )
}

const button = (name: string) => screen.getByRole('button', { name })

describe('the two guidance buttons', () => {
  it('ask about the section open, with no question typed', async () => {
    const calls = gateway()
    render(<Tab />)
    const group = await screen.findByRole('group', { name: 'Writing guidance' })
    expect(within(group).getByText('7. Construction')).toBeInTheDocument()
    fireEvent.click(button('What is missing from this section?'))
    await screen.findByText('Section 7 has 2 findings waiting for a decision.')
    const posted = calls.filter((c) => c.method === 'POST')
    expect(posted).toHaveLength(1)
    expect(posted[0].body).toEqual({ guide: { kind: 'missing', sectionId: '7' } })
    // The question as the conversation keeps it.
    expect(screen.getByText('What is missing from 7. Construction?')).toBeInTheDocument()
  })

  it('are greyed out with the reason where they do not apply', async () => {
    gateway()
    const { unmount } = render(<Tab target={{ sectionId: '2', label: '2. Executive Summary' }} />)
    await screen.findByRole('group', { name: 'Writing guidance' })
    expect(button('What should this section cover?')).toHaveAttribute('aria-disabled', 'true')
    expect(button('What is missing from this section?')).not.toHaveAttribute('aria-disabled')
    unmount()

    const calls = gateway()
    render(<Tab target={{ sectionId: '1', label: '1. Purpose and Scope' }} />)
    await screen.findByRole('group', { name: 'Writing guidance' })
    for (const name of ['What should this section cover?', 'What is missing from this section?'])
      expect(button(name)).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button('What is missing from this section?'))
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  it('are not offered on an archived assessment, which is read only', async () => {
    gateway({ archived: true, questions: [MISSING] })
    render(<Tab />)
    await screen.findByText('Section 7 has 2 findings waiting for a decision.')
    expect(screen.queryByRole('group', { name: 'Writing guidance' })).not.toBeInTheDocument()
  })
})

describe('What is missing from this section? (AC2, AC3, AC4)', () => {
  it('lists what blocks the export first, then the rest, each with its link', async () => {
    const onGo = vi.fn()
    gateway()
    render(<Tab onGo={onGo} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'What is missing from this section?' }),
    )
    const card = await screen.findByRole('article', {
      name: 'Answer to: What is missing from 7. Construction?',
    })
    expect(within(card).getByText('Missing from 7. Construction')).toBeInTheDocument()
    const blocking = within(card).getByRole('region', { name: 'Blocks the export' })
    expect(
      within(blocking)
        .getAllByRole('listitem')
        .map((li) => li.firstChild?.textContent),
    ).toEqual(['Section 7 has 2 findings waiting for a decision.'])
    const others = within(card).getByRole('region', { name: 'Also missing' })
    expect(within(others).getAllByRole('listitem')).toHaveLength(3)
    // Not AI-written: no confidence, no violet answer card.
    expect(card).not.toHaveClass('ask-answer')

    fireEvent.click(
      within(blocking).getByRole('button', {
        name: 'Go to section: Section 7 has 2 findings waiting for a decision.',
      }),
    )
    expect(onGo).toHaveBeenLastCalledWith({ to: 'section', sectionId: '7', finding: '0.0' })
    fireEvent.click(
      within(others).getByRole('button', {
        name: "Go to section: Section 7's Construction Table reads Not entered.",
      }),
    )
    expect(onGo).toHaveBeenLastCalledWith({ to: 'section', sectionId: '7', subsection: 1 })
    fireEvent.click(within(others).getByRole('button', { name: /^Go to observation:/ }))
    expect(onGo).toHaveBeenLastCalledWith({ to: 'observation', observationId: 'o3' })
    fireEvent.click(within(others).getByRole('button', { name: /^Go to observations:/ }))
    expect(onGo).toHaveBeenLastCalledWith({ to: 'observation', observationId: null })
  })

  it('shows a saved list again when the conversation reopens, and when nothing is missing', async () => {
    gateway({
      questions: [MISSING, answer({ id: 'q9', guidance: { kind: 'missing', ...SEVEN }, gaps: [] })],
    })
    render(<Tab />)
    expect(
      await screen.findByText('Section 7 has 2 findings waiting for a decision.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Nothing is missing from 7. Construction.')).toBeInTheDocument()
  })
})

describe('What should this section cover? (AC1)', () => {
  it('cites the template, and a cited part goes to its place in the section', async () => {
    const onGo = vi.fn()
    const onCite = vi.fn()
    const calls = gateway()
    render(<Tab onGo={onGo} onCite={onCite} />)
    fireEvent.click(await screen.findByRole('button', { name: 'What should this section cover?' }))
    await screen.findByText(/Construction Table is a table completed from measured values/)
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      guide: { kind: 'cover', sectionId: '7' },
    })
    const cite = screen.getByRole('button', {
      name: 'Citation 1: Report template, 7. Construction › Construction Table',
    })
    fireEvent.click(cite)
    expect(onGo).toHaveBeenCalledWith({ to: 'section', sectionId: '7', subsection: 1 })
    expect(onCite).not.toHaveBeenCalled()
    // Its source is listed as the report template's part.
    const sources = screen.getByRole('region', { name: 'Sources' })
    expect(within(sources).getByText('7. Construction › Construction Table')).toBeInTheDocument()
    expect(within(sources).getByText('Table')).toBeInTheDocument()
  })

  it('asks again from a failure, as the same guidance', async () => {
    const failed = answer({
      id: 'q3',
      question: 'What should 7. Construction cover?',
      guidance: { kind: 'cover', ...SEVEN },
      status: 'failed',
      error: {
        step: 'generate',
        cause: 'the model provider did not respond',
        at: '2026-11-24T06:02:00.000Z',
      },
    })
    const calls = gateway({ questions: [failed] })
    render(<Tab />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      guide: { kind: 'cover', sectionId: '7' },
      conversation: 'c1',
    })
  })
})

describe('guidance never changes the report (AC5)', () => {
  it('sends nothing but the guidance request itself', async () => {
    const onGo = vi.fn()
    const calls = gateway()
    render(<Tab onGo={onGo} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'What is missing from this section?' }),
    )
    await screen.findByText('Section 7 has 2 findings waiting for a decision.')
    fireEvent.click(screen.getAllByRole('button', { name: /^Go to section:/ })[0])
    // The one write is the request itself: no save, version or decision.
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`)
    expect(writes).toEqual([`POST ${ASK}`])
  })
})
