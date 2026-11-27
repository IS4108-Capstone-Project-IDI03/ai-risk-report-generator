import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AskAnswer, AskConversation } from './api'
import { AskPanel } from './AskPanel'
import { useAsk } from './useAsk'
import {
  chooseOption,
  optionWords,
  selectField,
} from '../../../design-system/components/forms/selectTestHelpers'

// AS-03: the Ask tab keeps questions in conversations. It opens on the latest,
// lists the others, starts a new one and deletes one after confirming; on an
// archived assessment it is read only. The gateway is a stubbed fetch.

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
const ASK = `/api/assessments/${REF}/ask`
const SCOPE = {
  observations: 12,
  standards: [],
  standardsFrom: 'applicable',
  jurisdiction: 'SG',
  facilityType: 'Warehouse',
  pastReports: 0,
}
const conversation = (id: string, title: string, at: string, questions = 1): AskConversation => ({
  id,
  title,
  startedAt: at,
  lastAskedAt: at,
  questions,
})
const LATEST = conversation('c2', 'Was the B1 valve shut?', '2026-11-12T06:00:00.000Z', 2)
const OLDER = conversation('c1', 'When was the pump tested?', '2026-11-10T06:00:00.000Z')
const answer = (id: string, question: string): AskAnswer => ({
  id,
  question,
  passage: null,
  askedAt: '2026-11-12T06:00:00.000Z',
  status: 'complete',
  statements: [
    {
      text: `The answer to ${question}`,
      citations: [{ ref: 'O:o2', kind: 'observation', quote: null, verified: true }],
    },
  ],
  missing: [],
  passages: [],
  observations: [],
  confidence: 'high',
  error: null,
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
  conversations = [LATEST, OLDER],
  questions = [answer('q2', 'Was the B1 valve shut?'), answer('q3', 'Which bay?')],
  opened = { c1: [answer('q1', 'When was the pump tested?')] } as Record<string, AskAnswer[]>,
  asked = (() => sse()) as (body: Record<string, unknown>) => Promise<Response>,
  deleted = (() => Promise.resolve(new Response(null, { status: 204 }))) as (
    id: string,
  ) => Promise<Response>,
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
        conversations,
        conversation: conversations[0] ?? null,
        questions: conversations.length ? questions : [],
      })
    const id = url.startsWith(`${ASK}/conversations/`) ? url.split('/').at(-1)! : null
    if (id && method === 'DELETE') return deleted(id)
    if (id) {
      const found = conversations.find((c) => c.id === id)
      return found
        ? json(200, { conversation: found, questions: opened[id] ?? [] })
        : json(404, { error: 'This conversation could not be found.' })
    }
    return json(200, [])
  })
  return calls
}

function Tab() {
  const ask = useAsk(REF, true)
  return <AskPanel ask={ask} current={null} onCite={() => {}} />
}
const picker = () => selectField('Conversation')
// The conversations the picker lists, by their words (title · time of day).
const LATEST_WORDS = /^Was the B1 valve shut\? · /
const OLDER_WORDS = /^When was the pump tested\? · /
const STARTED_WORDS = /^Is the sprinkler riser tagged\? · /
const thread = () => screen.getByRole('list', { name: 'Questions and answers' })
const type = (question: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: question },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

describe('reopening the Ask tab (AC2)', () => {
  it('shows the latest conversation, and opens an older one from the picker', async () => {
    const calls = gateway()
    render(<Tab />)
    expect(await screen.findByText('The answer to Which bay?')).toBeInTheDocument()
    expect(picker()).toHaveTextContent(LATEST_WORDS)
    expect(optionWords('Conversation')).toEqual([
      expect.stringMatching(LATEST_WORDS),
      expect.stringMatching(OLDER_WORDS),
    ])

    chooseOption('Conversation', OLDER_WORDS)
    expect(await screen.findByText('The answer to When was the pump tested?')).toBeInTheDocument()
    expect(within(thread()).queryByText('The answer to Which bay?')).toBeNull()
    expect(picker()).toHaveTextContent(OLDER_WORDS)
    expect(calls.at(-1)).toMatchObject({ method: 'GET', url: `${ASK}/conversations/c1` })
  })

  it('asks in the conversation on screen', async () => {
    const calls = gateway()
    render(<Tab />)
    await screen.findByText('The answer to Which bay?')
    type('And the pump room?')
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      question: 'And the pump room?',
      conversation: 'c2',
    })
  })

  it('offers no picker before the first conversation', async () => {
    gateway({ conversations: [] })
    render(<Tab />)
    expect(await screen.findByRole('textbox', { name: 'Question' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Conversation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull()
  })
})

describe('New conversation (AC2)', () => {
  it('empties the tab, and its first question starts another conversation', async () => {
    const started = conversation('c3', 'Is the sprinkler riser tagged?', '2026-11-12T07:00:00.000Z')
    const calls = gateway({
      asked: (body) =>
        sse(
          {
            type: 'question',
            id: 'q9',
            question: body.question,
            askedAt: started.lastAskedAt,
            ...(body.conversation ? {} : { conversation: started }),
          },
          { type: 'result', answer: answer('q9', String(body.question)) },
        ),
    })
    render(<Tab />)
    await screen.findByText('The answer to Which bay?')

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(screen.queryByRole('list', { name: 'Questions and answers' })).toBeNull()
    expect(picker()).toHaveTextContent(/^New conversation$/)
    expect(optionWords('Conversation')[0]).toBe('New conversation')
    // Already a new one: nothing more to start, and nothing saved to delete.
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull()

    type('Is the sprinkler riser tagged?')
    expect(
      await screen.findByText('The answer to Is the sprinkler riser tagged?'),
    ).toBeInTheDocument()
    const [first] = calls.filter((c) => c.method === 'POST')
    expect(first.body).toEqual({ question: 'Is the sprinkler riser tagged?' })
    // Listed first, as the latest, and on screen.
    await waitFor(() => expect(picker()).toHaveTextContent(STARTED_WORDS))
    expect(optionWords('Conversation')).toEqual([
      expect.stringMatching(STARTED_WORDS),
      expect.stringMatching(LATEST_WORDS),
      expect.stringMatching(OLDER_WORDS),
    ])

    // The next question goes into it.
    type('Which floor?')
    await screen.findByText('The answer to Which floor?')
    expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({
      question: 'Which floor?',
      conversation: 'c3',
    })
  })
})

describe('Delete (AC2)', () => {
  it('asks to confirm, then deletes the conversation and opens the latest left', async () => {
    const calls = gateway()
    render(<Tab />)
    await screen.findByText('The answer to Which bay?')

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete this conversation?' })
    expect(within(dialog).getByText('Was the B1 valve shut?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        "Its 2 questions and answers are deleted for good and can't be opened again. Nothing in the report changes.",
      ),
    ).toBeInTheDocument()
    // Cancel deletes nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    dialog = screen.getByRole('dialog', { name: 'Delete this conversation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete conversation' }))

    expect(await screen.findByText('The answer to When was the pump tested?')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(`${ASK}/conversations/c2`)
    expect(picker()).toHaveTextContent(OLDER_WORDS)
    expect(optionWords('Conversation')).toEqual([expect.stringMatching(OLDER_WORDS)])
  })

  it('says why a conversation was not deleted, and keeps the dialog open', async () => {
    gateway({ deleted: () => Promise.reject(new TypeError('Failed to fetch')) })
    render(<Tab />)
    await screen.findByText('The answer to Which bay?')
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this conversation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete conversation' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "The conversation could not be deleted: the server can't be reached. Try again.",
    )
    expect(screen.getByText('The answer to Which bay?')).toBeInTheDocument()
  })

  it('leaves a new conversation once the last one is deleted', async () => {
    gateway({ conversations: [LATEST] })
    render(<Tab />)
    await screen.findByText('The answer to Which bay?')
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this conversation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete conversation' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('list', { name: 'Questions and answers' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Conversation' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
  })
})

describe('an archived assessment (AC5)', () => {
  it('shows its conversations read only: no question box, New conversation or Delete', async () => {
    gateway({ archived: true })
    render(<Tab />)
    expect(await screen.findByText('The answer to Which bay?')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(
      'This assessment is archived, so its conversations are read only.',
    )
    expect(screen.queryByRole('textbox', { name: 'Question' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull()
    // The others can still be read.
    chooseOption('Conversation', OLDER_WORDS)
    expect(await screen.findByText('The answer to When was the pump tested?')).toBeInTheDocument()
  })
})

describe('refusals while the tab is open (AC2, AC5)', () => {
  it('states why a question was refused once the assessment was archived', async () => {
    const at = new Date()
    at.setHours(10, 15, 0, 0)
    gateway({
      asked: () =>
        json(409, {
          error: 'Assessment RPT-2026-0001 is archived.',
          cause: 'the assessment is archived, so its conversations are read only',
          next: 'Restore the assessment to ask about it again.',
          at: at.toISOString(),
        }),
    })
    render(<Tab />)
    await screen.findByText('The answer to Which bay?')
    type('And the pump room?')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Answer stopped at 10:15: the assessment is archived, so its conversations are read only. Restore the assessment to ask about it again.',
    )
  })

  it('asks to start a new conversation once one is full', async () => {
    const at = new Date()
    at.setHours(11, 40, 0, 0)
    gateway({
      asked: () =>
        json(409, {
          error: 'A conversation holds at most 100 questions.',
          cause: 'this conversation holds 100 questions, the most it can',
          next: 'Start a new conversation.',
          at: at.toISOString(),
        }),
    })
    render(<Tab />)
    await screen.findByText('The answer to Which bay?')
    type('One more?')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Answer stopped at 11:40: this conversation holds 100 questions, the most it can. Start a new conversation.',
    )
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled()
  })
})

describe('the export (AC4)', () => {
  it("never imports the Ask tab: conversations can't reach the PDF or Word file", () => {
    // The export's pages and snapshot, followed through their relative imports.
    const root = resolve(process.cwd(), 'src/features/assessments/document/export')
    const start = ['ExportPages.tsx', 'exportDocument.ts', 'snapshot.ts'].map((f) => join(root, f))
    const seen = new Set<string>()
    const queue = [...start]
    while (queue.length) {
      const file = queue.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      for (const [, spec] of source.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
        const target = resolve(dirname(file), spec)
        const found = [target, `${target}.ts`, `${target}.tsx`, join(target, 'index.ts')].find(
          (f) => /\.tsx?$/.test(f) && existsSync(f),
        )
        if (found) queue.push(found)
      }
    }
    expect(seen.size).toBeGreaterThan(start.length)
    const names = [...seen].map((f) => f.replace(/\\/g, '/'))
    expect(names.filter((f) => f.includes('/assessments/ask/'))).toEqual([])
  })
})
