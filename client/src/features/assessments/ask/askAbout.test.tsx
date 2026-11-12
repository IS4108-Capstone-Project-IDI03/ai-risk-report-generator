import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ReviewSection, SourcePassage } from '../api'
import { MARKER } from '../comments/anchor'
import type { CommentAnchor } from '../comments/api'
import { ReviewWorkspace } from '../screens/ReviewWorkspace'
import type { AskAnswer } from './api'

// AS-02: asking about text selected in the review workspace's draft. The
// gateway is a stubbed fetch; an answer arrives as the events it streams.

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  // jsdom has no layout: a selection has no box.
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
  note: 'B1 sprinkler control valve found shut, read 7 bar.',
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
        statements: [finding(SHUT, ['O:o2', 'C:fm25:4']), finding(TAMPER, ['O:o2'])],
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
  sources: { 'C:fm25:4': STANDARD },
  observations: [VALVE],
}
const WORKSPACE = {
  sections: [FIRE],
  summary: { total: 2, pending: 2, accepted: 0, edited: 0, rejected: 0 },
  asOf: '2026-10-11T06:00:00.000Z',
}
// The section's text as the document editor reads it, and a passage in it.
const TEXT = `${SHUT}${MARKER}${MARKER}\n${TAMPER}${MARKER}`
const anchorOn = (words: string): CommentAnchor => {
  const start = TEXT.indexOf(words)
  const end = start + words.length
  return {
    sectionId: '9',
    start,
    end,
    exact: words,
    prefix: TEXT.slice(Math.max(0, start - 32), start),
    suffix: TEXT.slice(end, end + 32),
  }
}
const ON_VALVE = anchorOn('valve was found')
const ASKED: AskAnswer = {
  id: 'q1',
  question: 'Where does this come from?',
  passage: {
    anchor: ON_VALVE,
    label: '9. Fire Protection',
    citations: ['O:o2', 'C:fm25:4'],
    findings: ['0.0'],
  },
  askedAt: '2026-11-12T06:00:00.000Z',
  status: 'complete',
  statements: [
    {
      text: 'The observation records the valve found shut.',
      citations: [{ ref: 'O:o2', kind: 'observation', quote: null, verified: true }],
    },
  ],
  missing: [],
  passages: [STANDARD],
  observations: [VALVE],
  confidence: 'high',
  error: null,
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
  answer = (() => sse()) as (body: Record<string, unknown>) => Promise<Response>,
} = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })
    if (url === `/api/assessments/${REF}/ask`)
      return method === 'POST' ? answer(body) : json(200, { scope: null, questions: earlier })
    if (url === `/api/assessments/${REF}/review`) return json(200, WORKSPACE)
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    return json(200, [])
  })
  return calls
}

function open() {
  render(
    <ReviewWorkspace
      reference={REF}
      canReview
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
// Opens the Ask tab, once the workspace has loaded.
async function openAskTab() {
  const panel = await screen.findByRole('complementary', { name: 'Source panel' })
  fireEvent.click(await within(panel).findByRole('tab', { name: /^Ask/ }))
}

// Selects words of the draft as a reader does, in the text the draft shows.
async function selectWords(words: string) {
  const draft = await screen.findByRole('region', { name: 'Draft editor' })
  const span = [...draft.querySelectorAll('.rv-statement-text')].find((s) =>
    s.textContent!.includes(words),
  )!
  const node = span.firstChild as Text
  const at = node.data.indexOf(words)
  const range = document.createRange()
  range.setStart(node, at)
  range.setEnd(node, at + words.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

describe('Ask about this in the draft (AC1, AC2)', () => {
  it('offers Ask about this by the selection, and sends the passage with the question', async () => {
    const calls = gateway({
      answer: () =>
        sse(
          { type: 'question', id: 'q1', question: ASKED.question, askedAt: ASKED.askedAt },
          { type: 'statement', ...ASKED.statements[0] },
          { type: 'result', answer: ASKED },
        ),
    })
    open()
    await selectWords('valve was found')
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about this' }))

    // The Ask tab opens with the passage quoted verbatim in the question box.
    expect(within(inspector()).getByRole('tab', { name: /^Ask/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const quoted = within(askTab()).getByRole('figure', { name: 'Asking about 9. Fire Protection' })
    expect(quoted.querySelector('.ask-passage-text')).toHaveTextContent(/^valve was found$/)

    fireEvent.change(within(askTab()).getByRole('textbox', { name: 'Question' }), {
      target: { value: 'Where does this come from?' },
    })
    fireEvent.click(within(askTab()).getByRole('button', { name: 'Ask' }))

    await within(askTab()).findByText('The observation records the valve found shut.')
    const asked = calls.filter((c) => c.method === 'POST')
    expect(asked).toHaveLength(1)
    // The section, the passage and its citations; the findings it is in, by key.
    expect(asked[0].body).toEqual({
      question: 'Where does this come from?',
      passage: { anchor: ON_VALVE, citations: ['O:o2', 'C:fm25:4'], findings: ['0.0'] },
    })
    // The question quotes its passage; the question box no longer holds it.
    const item = within(askTab()).getByRole('figure', { name: '9. Fire Protection' })
    expect(item.querySelector('.ask-passage-text')).toHaveTextContent(/^valve was found$/)
    expect(within(askTab()).queryByRole('figure', { name: /^Asking about/ })).toBeNull()
    // Asking changes nothing in the report (AC5): no write but the question.
    expect(calls.filter((c) => c.method !== 'GET')).toEqual(asked)
  })

  it("asks about the selection from Ctrl+Alt+K, and not from Comment's Ctrl+Alt+M", async () => {
    gateway()
    open()
    await selectWords('tamper switch')
    fireEvent.keyDown(window, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })
    expect(within(inspector()).getByRole('tab', { name: 'Evidence' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })
    const quoted = within(askTab()).getByRole('figure', { name: 'Asking about 9. Fire Protection' })
    expect(quoted.querySelector('.ask-passage-text')).toHaveTextContent(/^tamper switch$/)
    // It can be taken off again before asking.
    fireEvent.click(within(quoted).getByRole('button', { name: "Don't ask about this passage" }))
    expect(within(askTab()).queryByRole('figure')).toBeNull()
  })

  it('says why a selection without the draft’s words cannot be asked about', async () => {
    gateway()
    open()
    const draft = await screen.findByRole('region', { name: 'Draft editor' })
    // Only the citation numbers after the first finding.
    const marks = [...draft.querySelectorAll('.rv-cite')].slice(0, 2)
    const range = document.createRange()
    range.setStartBefore(marks[0])
    range.setEndAfter(marks[1])
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    const button = await screen.findByRole('button', { name: 'Ask about this' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })
    // The reason box of the greyed-out button holds the same words for screen readers;
    // the shortcut adds them under the selection, as a status.
    expect(
      await screen.findByText(/^Can't ask here\. Select some of the text to ask about\./, {
        selector: '.rv-ask-hint',
      }),
    ).toHaveAttribute('role', 'status')
  })
})

describe('a question about a passage, later (AC3, AC4)', () => {
  it('links back to its passage in the draft and marks it there', async () => {
    gateway({ earlier: [ASKED] })
    open()
    await openAskTab()
    const quoted = await within(askTab()).findByRole('figure', { name: '9. Fire Protection' })
    fireEvent.click(within(quoted).getByRole('button', { name: 'Go to the passage' }))

    const marked = [...document.querySelectorAll('[data-asked]')]
    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveTextContent(SHUT)
  })

  it('says "Text deleted" once its passage is no longer in the section', async () => {
    const gone = anchorOn('valve was found')
    gateway({
      earlier: [
        {
          ...ASKED,
          passage: {
            ...ASKED.passage!,
            anchor: { ...gone, exact: 'sprinkler riser', prefix: 'Level 3 ', suffix: ' read' },
          },
        },
      ],
    })
    open()
    await openAskTab()
    const quoted = await within(askTab()).findByRole('figure', { name: '9. Fire Protection' })
    expect(within(quoted).getByText('Text deleted')).toBeInTheDocument()
    expect(within(quoted).queryByRole('button', { name: 'Go to the passage' })).toBeNull()
    expect(quoted.querySelector('.ask-passage-text')).toHaveTextContent('sprinkler riser')
  })

  it('names both figures where the sources disagree, without choosing (AC4)', async () => {
    const differs = {
      text: 'the observation records 7 bar, while FM Global 2-81 sets 10 bar.',
      citations: [
        { ref: 'O:o2', kind: 'observation' as const, quote: null, verified: true },
        { ref: 'C:fm25:4', kind: 'standard' as const, quote: '10 bar', verified: true },
      ],
      differs: true,
    }
    gateway({ earlier: [{ ...ASKED, statements: [differs], confidence: 'medium' }] })
    open()
    await openAskTab()
    const answer = await within(askTab()).findByRole('article', {
      name: 'Answer to: Where does this come from?',
    })
    const line = within(answer).getByText(/the observation records 7 bar/)
    expect(line.closest('p')).toHaveClass('ask-differs')
    expect(line.closest('p')).toHaveTextContent(/^Sources disagree:/)
    expect(within(line.closest('p')!).getAllByRole('button', { name: /^Citation/ })).toHaveLength(2)
    expect(within(answer).getByText('Medium confidence')).toBeInTheDocument()
  })
})
