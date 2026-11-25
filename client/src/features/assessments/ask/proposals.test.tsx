import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { reportDrafted } from '../generation/fixtures'
import type { ReviewSection, ReviewWorkspace as Workspace, SourcePassage } from '../api'
import { ReviewWorkspace } from '../screens/ReviewWorkspace'
import { markedText, unsupportedIn, unsupportedRanges } from '../aiText'
import type { AskAnswer, Proposal } from './api'

// AS-04: drafting or rewriting text for a section from the Ask tab, and
// putting it into the report. The gateway is a stubbed fetch; proposed text
// arrives as the events it streams.

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.getSelection()?.removeAllRanges()
})

const REF = 'RPT-2026-0001'
const SHUT = 'The B1 valve was found shut.'
const TAMPER = 'No tamper switch was fitted.'
const BARRIER = 'The valve is not supervised.'
const COMMON = 'Shut valves are a common cause of sprinkler failure.'
const STANDARD: SourcePassage = {
  id: 'C:fm25:4',
  kind: 'standard',
  text: 'Sprinkler control valves shall be supervised in the open position.',
  headings: ['Valves'],
  pageStart: 4,
  pageEnd: 4,
  documentId: 'fm25',
  document: {
    title: 'FM Global Data Sheet 2-81',
    issuingBody: 'FM Global',
    sourceType: 'fm_standard',
    edition: '2026',
    effectiveDate: '2026-01-01',
    withdrawnAt: null,
    fileUrl: '/api/knowledge-documents/fm25/file',
  },
}
const VALVE = {
  id: 'o2',
  copeDimensions: ['Protection'],
  note: 'B1 sprinkler control valve found shut.',
  transcripts: [],
  severity: 'high',
  location: 'Pump room, Basement 1',
  standard: null,
}
const finding = (text: string, citations: string[]) => ({
  text,
  generatedText: text,
  citations,
  supported: true,
  review: { state: 'pending' as const, at: null, by: null },
})
const FIRE: ReviewSection = {
  id: '9',
  title: 'Fire Protection',
  copeDimensions: ['Protection'],
  completion: { state: 'complete', written: 1, total: 1, tables: 0 },
  review: {
    state: 'ai_draft',
    unsupportedStatements: 0,
    withdrawnSources: 0,
    changesSinceDraft: 0,
    changeCounts: { added: 0, changed: 0, removed: 0 },
  },
  draft: {
    id: 'd9',
    sectionId: '9',
    title: 'Fire Protection',
    subsections: [
      {
        heading: 'Sprinkler Protection',
        kind: 'narrative',
        statements: [finding(SHUT, ['O:o2']), finding(TAMPER, ['O:o2'])],
      },
    ],
    questions: [],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt_version: 'gn01-v2.4',
      template_version: 'global-pre-v2.0-2026-02',
      generated_at: '2026-10-03T06:00:00.000Z',
    },
    createdAt: '2026-10-03T06:00:00.000Z',
  },
  findings: { total: 2, pending: 2, accepted: 0, edited: 0, rejected: 0 },
  replacement: null,
  history: [],
  sources: {},
  observations: [VALVE],
}
const WORKSPACE: Workspace = {
  sections: [FIRE],
  summary: { total: 2, pending: 2, accepted: 0, edited: 0, rejected: 0 },
  asOf: '2026-10-11T06:00:00.000Z',
}

const SUPPORTED = {
  text: BARRIER,
  citations: [
    { ref: 'O:o2', kind: 'observation' as const, quote: null, verified: true },
    { ref: 'C:fm25:4', kind: 'standard' as const, quote: 'supervised', verified: true },
  ],
  supported: true,
  paragraph: 0,
}
const BARE = { text: COMMON, citations: [], supported: false, paragraph: 0 }
const PROPOSAL: Proposal = {
  id: 'p1',
  kind: 'draft',
  sectionId: '9',
  label: '9. Fire Protection',
  choices: [{ index: 0, heading: 'Sprinkler Protection' }],
  subsection: 0,
  before: null,
  sentences: [SUPPORTED, BARE],
  status: 'proposed',
  inserted: null,
  settled: null,
  canUndo: false,
}
const DRAFTED: AskAnswer = {
  id: 'q1',
  question: 'Draft a paragraph on the valve supervision',
  passage: null,
  proposal: PROPOSAL,
  askedAt: '2026-11-16T06:00:00.000Z',
  status: 'complete',
  statements: [SUPPORTED, BARE],
  missing: [],
  passages: [STANDARD],
  observations: [VALVE],
  confidence: null,
  error: null,
}
// The section once the text was inserted: its newest version holds it as AI draft.
const INSERTED: Workspace = {
  ...WORKSPACE,
  asOf: '2026-11-16T06:01:00.000Z',
  sections: [
    {
      ...FIRE,
      review: { ...FIRE.review, state: 'needs_review', aiText: { pending: 1, unsupported: 1 } },
      sources: { 'C:fm25:4': STANDARD },
      document: {
        version: 1,
        draftId: 'd9',
        current: true,
        savedAt: '2026-11-16T06:01:00.000Z',
        savedBy: { id: 'u1', name: 'Alex Rowe' },
        document: {
          intro: [],
          subsections: [
            {
              heading: 'Sprinkler Protection',
              blocks: [
                { type: 'paragraph', finding: '0.0', content: [{ type: 'text', text: SHUT }] },
                { type: 'paragraph', finding: '0.1', content: [{ type: 'text', text: TAMPER }] },
                {
                  type: 'paragraph',
                  ai: 'p1',
                  content: [
                    { type: 'text', text: BARRIER },
                    { type: 'cite', id: 'O:o2' },
                    { type: 'cite', id: 'C:fm25:4' },
                    { type: 'text', text: ` ${COMMON}` },
                  ],
                },
              ],
            },
          ],
        },
      },
      aiDrafts: [
        {
          id: 'p1',
          kind: 'draft',
          request: DRAFTED.question,
          unsupported: [COMMON],
          insertedAt: '2026-11-16T06:01:00.000Z',
          insertedBy: { id: 'u1', name: 'Alex Rowe' },
        },
      ],
    },
  ],
}

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
  earlier = [] as AskAnswer[],
  workspace = WORKSPACE,
  answer = (() => sse()) as (body: Record<string, unknown>) => Promise<Response>,
  proposal = (() => json(200, {})) as (url: string) => Promise<Response>,
} = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })
    if (url === `/api/assessments/${REF}/ask`)
      return method === 'POST' ? answer(body) : json(200, { scope: null, questions: earlier })
    if (url.startsWith(`/api/assessments/${REF}/proposals/`)) return proposal(url)
    if (url === `/api/assessments/${REF}/review`) return json(200, workspace)
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    // The drafting state (GN-13): all 11 parts drafted, so Review shows every part.
    if (url === `/api/assessments/${REF}/generation`) return json(200, reportDrafted)
    return json(200, [])
  })
  return calls
}

function open(canReview = true) {
  render(
    <ReviewWorkspace
      reference={REF}
      canReview={canReview}
      canAsk
      wrapStyle={{}}
      railStyle={{}}
      panelStyle={{}}
      onGenerate={() => {}}
    />,
  )
}
const inspector = () => screen.getByRole('complementary', { name: 'Source panel' })
const askTab = () => within(inspector()).getByRole('tabpanel', { name: 'Ask' })
async function openAskTab() {
  const panel = await screen.findByRole('complementary', { name: 'Source panel' })
  fireEvent.click(await within(panel).findByRole('tab', { name: /^Ask/ }))
}

describe('Draft text (AC1)', () => {
  it('asks for text for the open section and shows it, each sentence cited or unsupported', async () => {
    const calls = gateway({
      answer: () =>
        sse(
          { type: 'question', id: 'q1', question: DRAFTED.question, askedAt: DRAFTED.askedAt },
          { type: 'step', step: 'generate' },
          { type: 'target', subsection: 0 },
          { type: 'statement', ...SUPPORTED, passages: [STANDARD], observations: [VALVE] },
          { type: 'statement', ...BARE },
          { type: 'result', answer: DRAFTED },
        ),
    })
    open()
    await openAskTab()
    fireEvent.change(within(askTab()).getByRole('textbox', { name: 'Question' }), {
      target: { value: DRAFTED.question },
    })
    fireEvent.click(within(askTab()).getByRole('button', { name: 'Draft text' }))

    const card = await within(askTab()).findByRole('article', {
      name: `Proposed text: ${DRAFTED.question}`,
    })
    const [asked] = calls.filter((c) => c.method === 'POST')
    expect(asked.body).toEqual({
      question: DRAFTED.question,
      propose: { kind: 'draft', sectionId: '9' },
    })
    expect(within(card).getByText(/Proposed text · 9\. Fire Protection/)).toBeInTheDocument()
    // The supported sentence cites its two sources; the other is marked (AC3).
    const text = within(card).getByRole('group', { name: 'Proposed text' })
    expect(within(text).getAllByRole('button', { name: /^Citation/ })).toHaveLength(2)
    const bare = within(text).getByText(COMMON)
    expect(bare.closest('.ask-unsupported')).not.toBeNull()
    expect(within(card).getByText('Unsupported')).toBeInTheDocument()
    expect(within(card).getByText('At the end of Sprinkler Protection')).toBeInTheDocument()
    // Nothing in the report changed: no write but the request.
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([asked])
  })

  it('inserts the text, which then shows in the section as AI draft, and can be undone (AC2)', async () => {
    const calls = gateway({
      earlier: [DRAFTED],
      proposal: (url) =>
        url.endsWith('/insert')
          ? json(200, {
              proposal: {
                ...PROPOSAL,
                status: 'inserted',
                inserted: {
                  at: '2026-11-16T06:01:00.000Z',
                  by: { id: 'u1', name: 'Alex Rowe' },
                  version: 1,
                },
                canUndo: true,
              },
              workspace: INSERTED,
            })
          : json(200, {
              proposal: {
                ...PROPOSAL,
                status: 'undone',
                settled: { action: 'undone', at: '2026-11-16T06:02:00.000Z' },
              },
              workspace: { ...WORKSPACE, asOf: '2026-11-16T06:02:00.000Z' },
            }),
    })
    open()
    await openAskTab()
    const card = await within(askTab()).findByRole('article', { name: /^Proposed text/ })
    fireEvent.click(within(card).getByRole('button', { name: 'Insert' }))

    expect(await within(card).findByText(/^Inserted into 9\. Fire Protection at/)).toBeVisible()
    const insert = calls.find((c) => c.url.endsWith('/proposals/p1/insert'))!
    expect(insert.body).toEqual({ subsection: 0 })
    // In the section: violet, its unsupported sentence marked, Accept greyed out.
    const draft = screen.getByRole('region', { name: 'Draft editor' })
    const ai = within(draft).getByRole('group', { name: 'AI-drafted text' })
    expect(within(ai).getByText('AI draft')).toBeInTheDocument()
    expect(ai.querySelector('mark.rv-ai-unsupported')).toHaveTextContent(COMMON)
    expect(within(ai).getByRole('button', { name: 'Accept the AI-drafted text' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(draft).getByText('AI-drafted text to review')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Undo' }))
    expect(await within(card).findByText(/^Undone at/)).toBeVisible()
    expect(calls.some((c) => c.url.endsWith('/proposals/p1/undo'))).toBe(true)
    expect(within(draft).queryByRole('group', { name: 'AI-drafted text' })).toBeNull()
  })

  it('asks to draft the text again when the section changed since (AC6)', async () => {
    const calls = gateway({
      earlier: [DRAFTED],
      proposal: () =>
        json(409, {
          error: 'The section changed.',
          cause:
            'the section changed after this text was proposed, so inserting it could overwrite that change',
          next: 'Draft the text again to start from the section as it is now.',
          at: '2026-11-16T06:03:00.000Z',
          code: 'stale',
        }),
      answer: () => sse({ type: 'question', id: 'q2', question: DRAFTED.question, askedAt: '' }),
    })
    open()
    await openAskTab()
    const card = await within(askTab()).findByRole('article', { name: /^Proposed text/ })
    fireEvent.click(within(card).getByRole('button', { name: 'Insert' }))

    const alert = await within(card).findByRole('alert')
    expect(alert).toHaveTextContent('The section changed')
    expect(alert).toHaveTextContent('Draft the text again to start from the section as it is now.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Draft again' }))
    const posted = calls.filter((c) => c.url.endsWith('/ask') && c.method === 'POST')
    expect(posted).toHaveLength(1)
    expect(posted[0].body).toMatchObject({ propose: { kind: 'draft', sectionId: '9' } })
  })
})

describe('Rewrite this (AC1)', () => {
  it('puts the selection in the box to be rewritten, and asks for a rewrite', async () => {
    const calls = gateway()
    open()
    const draft = await screen.findByRole('region', { name: 'Draft editor' })
    const span = [...draft.querySelectorAll('.rv-statement-text')].find((s) =>
      s.textContent!.includes('tamper switch'),
    )!
    const node = span.firstChild as Text
    const range = document.createRange()
    range.setStart(node, node.data.indexOf('tamper switch'))
    range.setEnd(node, node.data.indexOf('tamper switch') + 'tamper switch'.length)
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    fireEvent.click(await screen.findByRole('button', { name: 'Rewrite this' }))

    const quoted = within(askTab()).getByRole('figure', { name: 'Rewriting 9. Fire Protection' })
    expect(quoted.querySelector('.ask-passage-text')).toHaveTextContent(/^tamper switch$/)
    fireEvent.click(within(askTab()).getByRole('button', { name: 'Rewrite' }))

    const [asked] = calls.filter((c) => c.method === 'POST')
    expect(asked.body).toMatchObject({
      question: 'Rewrite this passage.',
      propose: { kind: 'rewrite' },
      passage: { citations: ['O:o2'], findings: ['0.1'] },
    })
  })
})

describe('who sees Insert (AC5)', () => {
  it('offers no Draft text, Rewrite this or Insert to someone who can only read', async () => {
    gateway({ earlier: [DRAFTED] })
    open(false)
    await openAskTab()
    const card = await within(askTab()).findByRole('article', { name: /^Proposed text/ })
    expect(within(card).queryByRole('button', { name: 'Insert' })).toBeNull()
    expect(within(askTab()).queryByRole('button', { name: 'Draft text' })).toBeNull()
  })
})

describe('accepting the text in the section (AC2, AC3)', () => {
  it('accepts it once every sentence is supported', async () => {
    const supported = structuredClone(INSERTED)
    const section = supported.sections[0]
    section.aiDrafts![0].unsupported = []
    section.review.aiText = { pending: 1, unsupported: 0 }
    const calls = gateway({
      workspace: supported,
      proposal: () =>
        json(200, {
          proposal: { ...PROPOSAL, status: 'accepted' },
          workspace: { ...WORKSPACE, asOf: '2026-11-16T06:05:00.000Z' },
        }),
    })
    open()
    const draft = await screen.findByRole('region', { name: 'Draft editor' })
    const ai = await within(draft).findByRole('group', { name: 'AI-drafted text' })
    fireEvent.click(within(ai).getByRole('button', { name: 'Accept the AI-drafted text' }))

    await vi.waitFor(() =>
      expect(within(draft).queryByRole('group', { name: 'AI-drafted text' })).toBeNull(),
    )
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/proposals/p1/accept'))).toBe(
      true,
    )
  })
})

describe('the subsection source count', () => {
  it('counts the cite marks in text already accepted, not only text awaiting Accept', async () => {
    const accepted = structuredClone(INSERTED)
    const section = accepted.sections[0]
    const text = section.document!.document.subsections[0].blocks[2] as { ai?: string }
    delete text.ai
    section.aiDrafts = []
    section.review.aiText = { pending: 0, unsupported: 0 }
    gateway({ workspace: accepted })
    open()
    const draft = await screen.findByRole('region', { name: 'Draft editor' })
    // The findings cite O:o2; the accepted paragraph adds C:fm25:4.
    expect(await within(draft).findByRole('button', { name: /2 sources/ })).toBeInTheDocument()
  })
})

describe('unsupported sentences (AC3)', () => {
  const content = [
    { type: 'text' as const, text: BARRIER },
    { type: 'cite' as const, id: 'O:o2' },
    { type: 'text' as const, text: `  ${COMMON}` },
  ]
  it('are marked while in the text with no citation straight after', () => {
    const text = markedText(content)
    const [[start, end]] = unsupportedRanges(text, [COMMON])
    expect(text.slice(start, end)).toBe(COMMON)
    // Given a citation, reworded or deleted, they are resolved.
    expect(unsupportedRanges(`${text}￼`, [COMMON])).toEqual([])
    expect(unsupportedRanges(text, ['Shut valves cause failures.'])).toEqual([])
    const document = {
      intro: [],
      subsections: [{ heading: 'x', blocks: [{ type: 'paragraph' as const, ai: 'p1', content }] }],
    }
    expect(unsupportedIn(document, [{ id: 'p1', unsupported: [COMMON, BARRIER] }])).toEqual(
      new Map([['p1', [COMMON]]]),
    )
  })
})
