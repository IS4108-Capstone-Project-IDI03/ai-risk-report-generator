import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from '../../../App'
import { signIn } from '../../../test/session'
import type {
  FindingCounts,
  ReviewSection,
  ReviewStatement,
  ReviewWorkspace,
  Summary,
} from '../api'
import type { AskAnswer } from './api'

// AS-02: asking about text selected in the document editor (RV-08), beside
// Comment (RV-03). The gateway is a stubbed fetch.

beforeAll(() => {
  // jsdom has no native dialogs, layout or scrolling; ProseMirror asks for them.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList
  Element.prototype.scrollIntoView = vi.fn()
  document.elementFromPoint = () => null
})

const REF = 'RPT-2026-0001'
const ASK = `/api/assessments/${REF}/ask`
const ALEX = { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' }
const RECORD = {
  id: '6ab39003058299a45f20c9d4',
  reference: REF,
  client: 'Straits Logistics',
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: '2026-05-02',
  engineer: ALEX,
  status: 'draft',
  captureStartedAt: '2026-09-23T09:05:00.000Z',
  createdAt: '2026-09-23T09:00:00.000Z',
  site: {
    code: 'SITE-0001',
    name: 'Jurong Distribution Hub',
    address: null,
    jurisdiction: 'SG',
    facilityType: 'Distribution warehouse',
  },
}
const finding = (text: string, citations: string[]): ReviewStatement => ({
  text,
  generatedText: text,
  citations,
  supported: true,
  citationsRemoved: [],
  review: { state: 'pending', at: null, by: null },
})
const counts = (pending = 0): FindingCounts => ({
  total: pending,
  pending,
  accepted: 0,
  edited: 0,
  rejected: 0,
})
const RISER = 'Riser penetrations were not fire-stopped at Level 3.'
const ROOF = 'The roof is of fire-resistive construction.'
// Section 7's text as the document editor reads it: the riser finding cites o1.
const TEXT = `${RISER}\uFFFC\n${ROOF}`
const SEVEN: ReviewSection = {
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  completion: { state: 'complete', written: 1, total: 1, tables: 0 },
  review: {
    state: 'ai_draft',
    unsupportedStatements: 0,
    withdrawnSources: 0,
    changesSinceDraft: 0,
    changeCounts: { added: 0, changed: 0, removed: 0 },
  },
  draft: {
    id: 'd7',
    sectionId: '7',
    title: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        kind: 'narrative',
        statements: [finding(RISER, ['O:o1']), finding(ROOF, [])],
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
  findings: counts(2),
  sources: {},
  observations: [],
  replacement: null,
  history: [],
  document: null,
}
const WORKSPACE: ReviewWorkspace = {
  sections: [SEVEN],
  parts: { '1': null, '2': null, '3': null, A: null },
  summary: counts(2),
  asOf: '2026-10-19T02:00:00.000Z',
}
const SUMMARY: Summary = {
  purposeAndScope: ['This report was prepared for Straits Logistics.'],
  executiveSummary: { draft: null, missing: [], staleSections: [] },
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

type Call = { method: string; url: string; body: Record<string, unknown> | undefined }
const calls: Call[] = []
let earlier: AskAnswer[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })
    if (url === ASK && method === 'POST') {
      const answer: AskAnswer = {
        id: 'q9',
        question: String(body.question),
        passage: { ...body.passage, label: '7. Construction' },
        askedAt: '2026-11-12T06:00:00.000Z',
        status: 'complete',
        statements: [],
        missing: ['no observation records when the riser was fire-stopped.'],
        passages: [],
        observations: [],
        confidence: null,
        error: null,
      }
      return sse(
        { type: 'question', id: 'q9', question: answer.question, askedAt: answer.askedAt },
        { type: 'missing', text: answer.missing[0] },
        { type: 'result', answer },
      )
    }
    if (url === ASK) return json(200, { scope: null, questions: earlier })
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/review`) return json(200, WORKSPACE)
    if (url === `/api/assessments/${REF}/sections`) return json(200, [])
    if (url === `/api/assessments/${REF}/summary`) return json(200, SUMMARY)
    if (url === `/api/assessments/${REF}/comments`) return json(200, { threads: [] })
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    return json(200, [])
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  calls.length = 0
  earlier = []
})

async function openDocument(role: 'risk_engineer' | 'knowledge_admin' = 'risk_engineer') {
  mockGateway()
  window.history.replaceState(null, '', '/assessments')
  render(<App />)
  await signIn(role)
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }))
  const name = role === 'risk_engineer' ? 'Edit document' : 'Open document'
  fireEvent.click(await screen.findByRole('button', { name }))
  await screen.findByRole('textbox', { name: 'Report document' }, { timeout: 10_000 })
}

const page = () => screen.getByRole('textbox', { name: 'Report document' })
const editorOf = () => (page() as HTMLElement & { editor: Editor }).editor
const askPanel = () => screen.getByRole('complementary', { name: 'Ask' })
const askButton = () => screen.getByRole('button', { name: /^Ask about this \(Ctrl\+Alt\+K\)/ })
// Selects some words of the document.
function select(words: string) {
  const found: { from: number; to: number }[] = []
  editorOf().state.doc.descendants((node, pos) => {
    if (found.length || !node.isTextblock) return !found.length
    const at = node.textContent.indexOf(words)
    if (at !== -1) found.push({ from: pos + 1 + at, to: pos + 1 + at + words.length })
    return false
  })
  act(() => {
    editorOf().commands.setTextSelection(found[0])
  })
}

it('asks about the selected text from the toolbar, beside Comment (AC1, AC2, AC5)', async () => {
  await openDocument()
  // Nothing selected: Ask about this says why it can't be used yet.
  expect(askButton()).toHaveAttribute('aria-disabled', 'true')

  select('not fire-stopped')
  fireEvent.click(askButton())
  const quoted = within(askPanel()).getByRole('figure', { name: 'Asking about 7. Construction' })
  expect(quoted.querySelector('.ask-passage-text')).toHaveTextContent(/^not fire-stopped$/)
  // The passage waits in the text, marked but not changed.
  expect(page().querySelector('.dm-asked.is-pending')).toHaveTextContent('not fire-stopped')

  fireEvent.change(within(askPanel()).getByRole('textbox', { name: 'Question' }), {
    target: { value: 'When was this found?' },
  })
  fireEvent.click(within(askPanel()).getByRole('button', { name: 'Ask' }))
  expect(
    await within(askPanel()).findByText('no observation records when the riser was fire-stopped.'),
  ).toBeInTheDocument()

  const [asked] = calls.filter((c) => c.method === 'POST' && c.url === ASK)
  expect(asked.body).toEqual({
    question: 'When was this found?',
    passage: {
      anchor: {
        sectionId: '7',
        start: 24,
        end: 40,
        exact: 'not fire-stopped',
        prefix: 'Riser penetrations were ',
        suffix: TEXT.slice(40, 72),
      },
      citations: ['O:o1'],
      findings: ['0.0'],
    },
  })
  // Asking is not a change to the text: nothing is saved or waits to be (AC5).
  expect(calls.filter((c) => c.method !== 'GET' && c.url !== ASK)).toEqual([])
  expect(screen.getByText('All changes saved')).toBeInTheDocument()
  expect(page().querySelector('.dm-asked.is-pending')).toBeNull()
}, 20_000)

it('asks from Ctrl+Alt+K, while Ctrl+Alt+M still starts a comment (AC1)', async () => {
  await openDocument()
  select('roof')
  fireEvent.keyDown(page(), { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })
  expect(
    within(askPanel()).getByRole('figure', { name: 'Asking about 7. Construction' }),
  ).toHaveTextContent('roof')

  select('Riser')
  fireEvent.keyDown(page(), { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })
  expect(screen.getByRole('textbox', { name: 'New comment' })).toBeInTheDocument()
  // The Ask panel steps aside for the comment, as for the comments list.
  expect(screen.queryByRole('complementary', { name: 'Ask' })).toBeNull()
}, 20_000)

it('goes back to a passage asked about, and says "Text deleted" once it is gone (AC3)', async () => {
  const start = TEXT.indexOf('roof')
  const anchor = {
    sectionId: '7',
    start,
    end: start + 4,
    exact: 'roof',
    prefix: TEXT.slice(start - 32, start),
    suffix: TEXT.slice(start + 4, start + 36),
  }
  const answer = (id: string, words: Partial<typeof anchor>): AskAnswer => ({
    id,
    question: `Question ${id}`,
    passage: {
      anchor: { ...anchor, ...words },
      label: '7. Construction',
      citations: [],
      findings: ['0.1'],
    },
    askedAt: '2026-11-12T06:00:00.000Z',
    status: 'complete',
    statements: [],
    missing: ['nothing records it.'],
    passages: [],
    observations: [],
    confidence: null,
    error: null,
  })
  earlier = [answer('q1', {}), answer('q2', { exact: 'basement', prefix: 'B2 ', suffix: ' walls' })]
  await openDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this assessment' }))

  const [kept, gone] = within(askPanel()).getAllByRole('figure', { name: '7. Construction' })
  expect(within(gone).getByText('Text deleted')).toBeInTheDocument()
  fireEvent.click(within(kept).getByRole('button', { name: 'Go to the passage' }))
  await waitFor(() => expect(page().querySelector('.dm-asked')).toHaveTextContent('roof'))
}, 20_000)

it('lets a knowledge admin ask in the read-only document too (AC1)', async () => {
  await openDocument('knowledge_admin')
  select('not fire-stopped')
  fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })
  expect(
    within(askPanel()).getByRole('figure', { name: 'Asking about 7. Construction' }),
  ).toHaveTextContent('not fire-stopped')
}, 20_000)
