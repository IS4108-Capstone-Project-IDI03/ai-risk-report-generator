import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ReviewSection, SourcePassage } from '../api'
import { ReviewWorkspace } from '../screens/ReviewWorkspace'
import type { AskAnswer } from './api'

// AS-01: the Ask tab beside the evidence panel. The gateway is a stubbed fetch;
// an answer arrives as the server-sent events it streams.

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

const REF = 'RPT-2026-0001'
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
        statements: [
          {
            text: 'The B1 valve was found shut.',
            generatedText: 'The B1 valve was found shut.',
            citations: ['O:o2'],
            supported: true,
            review: { state: 'pending', at: null, by: null },
          },
        ],
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
  findings: { total: 1, pending: 1, accepted: 0, edited: 0, rejected: 0 },
  replacement: null,
  history: [],
  sources: {},
  observations: [VALVE],
}
const WORKSPACE = {
  sections: [FIRE],
  summary: { total: 1, pending: 1, accepted: 0, edited: 0, rejected: 0 },
  asOf: '2026-10-11T06:00:00.000Z',
}
const SCOPE = {
  observations: 12,
  standards: [{ id: 'fm25', name: 'FM Global 2-81 (2026)' }],
  standardsFrom: 'checklist',
  jurisdiction: 'SG',
  facilityType: 'Warehouse',
  pastReports: 3,
}
const STATEMENTS = [
  {
    text: 'The B1 sprinkler control valve was found shut.',
    citations: [{ ref: 'O:o2', kind: 'observation', quote: null, verified: true }],
  },
  {
    text: 'FM Global 2-81 requires such valves to be supervised open.',
    citations: [
      {
        ref: 'C:fm25:4',
        kind: 'standard',
        quote: 'supervised in the open position',
        verified: true,
      },
    ],
  },
] as const
const ANSWER: AskAnswer = {
  id: 'q1',
  question: 'Was the B1 valve shut?',
  askedAt: '2026-11-09T06:00:00.000Z',
  status: 'complete',
  statements: STATEMENTS.map((s) => ({ ...s, citations: [...s.citations] })),
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

type Asked = { question: string }
function gateway({
  earlier = [] as AskAnswer[],
  answer = (() => sse()) as (asked: Asked) => Promise<Response>,
  list = () => json(200, { scope: SCOPE, questions: earlier }),
} = {}) {
  const asked: Asked[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === `/api/assessments/${REF}/ask`) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Asked
        asked.push(body)
        return answer(body)
      }
      return list()
    }
    if (url === `/api/assessments/${REF}/review`) return json(200, WORKSPACE)
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    return json(200, [])
  })
  return asked
}

function open(canAsk = true) {
  render(
    <ReviewWorkspace
      reference={REF}
      canReview
      canAsk={canAsk}
      wrapStyle={{}}
      railStyle={{}}
      panelStyle={{}}
      onGenerate={() => {}}
    />,
  )
}
const inspector = () => screen.getByRole('complementary', { name: 'Source panel' })
async function openAsk() {
  open()
  fireEvent.click(
    await within(await screen.findByRole('complementary', { name: 'Source panel' })).findByRole(
      'tab',
      { name: /^Ask/ },
    ),
  )
  return within(inspector()).getByRole('tabpanel', { name: 'Ask' })
}
const ask = (panel: HTMLElement, question: string) => {
  fireEvent.change(within(panel).getByRole('textbox', { name: 'Question' }), {
    target: { value: question },
  })
  fireEvent.click(within(panel).getByRole('button', { name: 'Ask' }))
}

describe('the Ask tab (AC1)', () => {
  it('sits beside the evidence panel as a tab, keyboard-operable', async () => {
    gateway()
    open()
    const tabs = within(await screen.findByRole('complementary', { name: 'Source panel' }))
    const evidence = await tabs.findByRole('tab', { name: 'Evidence' })
    expect(evidence).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(evidence, { key: 'ArrowRight' })
    expect(tabs.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true')
    const panel = tabs.getByRole('tabpanel', { name: 'Ask' })
    expect(within(panel).getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
    expect(
      await within(panel).findByText(
        'Searches its 12 observations, 1 standard kept on its checklist and 3 past reports on Warehouse sites in SG.',
      ),
    ).toBeInTheDocument()
  })

  it('is not offered without the reports:ask permission', async () => {
    gateway()
    open(false)
    await screen.findByRole('region', { name: 'Draft editor' })
    expect(within(inspector()).queryByRole('tab', { name: 'Ask' })).toBeNull()
  })

  it('opens as a bottom sheet below 760px', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 759px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    gateway()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about this assessment' }))
    const sheet = screen.getByRole('dialog', { name: 'Ask about this assessment' })
    expect(sheet).toHaveClass('ds-dialog-sheet')
    expect(within(sheet).getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
  })
})

describe('an answer (AC2, AC4, AC5)', () => {
  it('streams cited statements, and a citation opens its source in the evidence panel', async () => {
    const asked = gateway({
      answer: () =>
        sse(
          { type: 'question', id: 'q1', question: ANSWER.question, askedAt: ANSWER.askedAt },
          { type: 'step', step: 'retrieve' },
          { type: 'step', step: 'generate' },
          { type: 'statement', ...STATEMENTS[0] },
          { type: 'statement', ...STATEMENTS[1] },
          { type: 'result', answer: ANSWER },
        ),
    })
    const panel = await openAsk()
    ask(panel, '  Was the B1 valve shut?  ')

    const answer = await within(panel).findByRole('article', {
      name: 'Answer to: Was the B1 valve shut?',
    })
    expect(await within(answer).findByText(STATEMENTS[1].text)).toBeInTheDocument()
    expect(asked).toEqual([{ question: 'Was the B1 valve shut?' }])
    expect(within(answer).getByText('High confidence')).toBeInTheDocument()
    const sources = within(answer).getByRole('region', { name: 'Sources' })
    expect(within(sources).getByText('FM Global Data Sheet 2-81')).toBeInTheDocument()
    expect(within(sources).getByText('“supervised in the open position”')).toBeInTheDocument()

    // The standard is not cited by the draft; it still opens in the evidence panel.
    fireEvent.click(within(answer).getByRole('button', { name: /^Citation 2: External standard/ }))
    expect(within(inspector()).getByRole('tab', { name: 'Evidence' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const viewer = within(inspector()).getByRole('article', { name: 'Source passage' })
    expect(within(viewer).getByText('FM Global Data Sheet 2-81')).toBeInTheDocument()
    expect(within(viewer).getByText(STANDARD.text)).toBeInTheDocument()

    // An observation the draft cites is marked open in its list.
    fireEvent.click(within(inspector()).getByRole('tab', { name: /^Ask/ }))
    fireEvent.click(
      within(inspector()).getByRole('button', { name: /^Citation 1: Site observation/ }),
    )
    expect(
      within(inspector()).getByRole('article', { name: 'Field observation' }),
    ).toBeInTheDocument()
  })

  it('says what evidence is missing, and gives no confidence when nothing was answered', async () => {
    gateway({
      answer: () =>
        sse(
          {
            type: 'question',
            id: 'q2',
            question: 'When was the pump tested?',
            askedAt: ANSWER.askedAt,
          },
          { type: 'missing', text: 'no observation records when the fire pump was last tested.' },
          {
            type: 'result',
            answer: {
              ...ANSWER,
              id: 'q2',
              question: 'When was the pump tested?',
              statements: [],
              missing: ['no observation records when the fire pump was last tested.'],
              passages: [],
              observations: [],
              confidence: null,
            },
          },
        ),
    })
    const panel = await openAsk()
    ask(panel, 'When was the pump tested?')
    const answer = await within(panel).findByRole('article', { name: /When was the pump tested/ })
    expect(
      await within(answer).findByText('no observation records when the fire pump was last tested.'),
    ).toBeInTheDocument()
    expect(within(answer).getByText(/Evidence missing/)).toBeInTheDocument()
    expect(within(answer).queryByText(/confidence/)).toBeNull()
  })

  it('shows earlier questions when the tab opens again', async () => {
    gateway({ earlier: [ANSWER] })
    const panel = await openAsk()
    expect(
      await within(panel).findByRole('article', { name: 'Answer to: Was the B1 valve shut?' }),
    ).toBeInTheDocument()
    expect(within(inspector()).getByRole('tab', { name: 'Ask, 1' })).toBeInTheDocument()
  })

  it('asks for a question before sending one', async () => {
    const asked = gateway()
    const panel = await openAsk()
    ask(panel, '   ')
    expect(await within(panel).findByText('Type a question to ask.')).toBeInTheDocument()
    expect(asked).toEqual([])
  })
})

describe('failures (AC7, AC8)', () => {
  it('states the cause and time, then the next step', async () => {
    const at = new Date()
    at.setHours(14, 2, 0, 0)
    gateway({
      answer: () =>
        sse(
          { type: 'question', id: 'q3', question: 'Valve?', askedAt: ANSWER.askedAt },
          { type: 'statement', ...STATEMENTS[0] },
          {
            type: 'result',
            answer: {
              ...ANSWER,
              id: 'q3',
              question: 'Valve?',
              status: 'stopped',
              statements: [ANSWER.statements[0]],
              error: {
                step: 'generate',
                cause: 'the model provider did not respond',
                at: at.toISOString(),
              },
            },
          },
        ),
    })
    const panel = await openAsk()
    ask(panel, 'Valve?')
    const alert = await within(panel).findByRole('alert')
    expect(alert).toHaveTextContent(
      'Answer stopped at 14:02: the model provider did not respond. Ask again.',
    )
    // What was answered before it stopped stays.
    expect(within(panel).getByText(STATEMENTS[0].text)).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Ask again' })).toBeInTheDocument()
  })

  it('states a refusal over the question limits with its next step', async () => {
    const at = new Date()
    at.setHours(9, 30, 0, 0)
    gateway({
      answer: () =>
        json(429, {
          error: 'more than 10 questions were asked in a minute',
          cause: 'more than 10 questions were asked in a minute',
          next: 'Ask again in a minute.',
          at: at.toISOString(),
        }),
    })
    const panel = await openAsk()
    ask(panel, 'Valve?')
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Answer stopped at 09:30: more than 10 questions were asked in a minute. Ask again in a minute.',
    )
  })

  it('explains that it is unavailable without the gateway', async () => {
    gateway({ list: () => Promise.reject(new TypeError('Failed to fetch')) })
    const panel = await openAsk()
    expect(await within(panel).findByText('Ask is unavailable')).toBeInTheDocument()
    expect(
      within(panel).getByText('The gateway could not be reached, so nothing can be searched.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(within(panel).queryByRole('textbox')).toBeNull())
  })
})

describe('sources that arrive with each statement (AC2)', () => {
  it('opens a citation even when the answer stopped before its result', async () => {
    gateway({
      answer: () =>
        sse(
          { type: 'question', id: 'q4', question: 'Valve rule?', askedAt: ANSWER.askedAt },
          { type: 'statement', ...STATEMENTS[1], passages: [STANDARD], observations: [] },
        ),
    })
    const panel = await openAsk()
    ask(panel, 'Valve rule?')
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      /the answer ended before it was finished\. Ask again\./,
    )
    fireEvent.click(within(panel).getByRole('button', { name: /^Citation 1: External standard/ }))
    const viewer = within(inspector()).getByRole('article', { name: 'Source passage' })
    expect(within(viewer).getByText(STANDARD.text)).toBeInTheDocument()
  })

  it('names who may ask when the gateway refuses the question', async () => {
    gateway({ answer: () => json(403, { error: 'Your role does not allow this.' }) })
    const panel = await openAsk()
    ask(panel, 'Valve?')
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      /only the assigned engineer and knowledge admins can ask about this assessment\. Ask the assigned engineer or a knowledge admin\./,
    )
  })
})
