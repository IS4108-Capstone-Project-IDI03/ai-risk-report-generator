import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from '../../../App'
import { signIn, testAuth } from '../../../test/session'
import type {
  FindingCounts,
  ReportSection,
  ReviewSection,
  ReviewStatement,
  ReviewWorkspace,
  Summary,
} from '../api'
import { formatDayTime } from '../format'
import type { CommentAnchor, CommentThread, ReportComment, Stamp } from './api'

// Comments on the report in the document editor, as in Google Docs (RV-03).

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
const COMMENTS = `/api/assessments/${REF}/comments`
const ALEX: Stamp = { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' }
const SANA: Stamp = { id: '6ab39017e45cf009e4507734', name: 'Sana Patel' }
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
const PROVENANCE = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  effort: 'high',
  prompt_version: 'gn01-v2.4',
  template_version: 'global-pre-v2.0-2026-02',
  generated_at: '2026-10-03T06:00:00.000Z',
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
const VALVES = 'Valves are checked weekly.'
const drafted = (
  id: string,
  title: string,
  heading: string,
  statements: ReviewStatement[],
): ReviewSection => ({
  id,
  title,
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
    id: `d${id}`,
    sectionId: id,
    title,
    subsections: [{ heading, kind: 'narrative', statements }],
    questions: [],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: PROVENANCE,
    createdAt: '2026-10-03T06:00:00.000Z',
  },
  findings: counts(statements.length),
  sources: {},
  observations: [],
  replacement: null,
  history: [],
  document: null,
})
const WORKSPACE: ReviewWorkspace = {
  sections: [
    drafted('7', 'Construction', 'Construction Narrative', [finding(RISER, []), finding(ROOF, [])]),
    drafted('9', 'Fire Protection', 'Sprinkler Protection', [finding(VALVES, [])]),
  ],
  parts: { '1': null, '2': null, '3': null, A: null },
  summary: counts(3),
  asOf: '2026-10-19T02:00:00.000Z',
}
const LISTED: Partial<ReportSection>[] = []
const SUMMARY: Summary = {
  purposeAndScope: ['This report was prepared for Straits Logistics.'],
  executiveSummary: { draft: null, missing: [], staleSections: [] },
}

// Threads on the riser finding, the valves and the roof.
const ON_RISER: CommentAnchor = {
  sectionId: '7',
  start: 24,
  end: 40,
  exact: 'not fire-stopped',
  prefix: 'Riser penetrations were ',
  suffix: ' at Level 3.',
}
const ON_VALVES: CommentAnchor = {
  sectionId: '9',
  start: 0,
  end: 6,
  exact: 'Valves',
  prefix: '',
  suffix: ' are checked weekly.',
}
const ON_ROOF: CommentAnchor = {
  sectionId: '7',
  start: 57,
  end: 61,
  exact: 'roof',
  prefix: 'Level 3.\n',
  suffix: ' is of fire-resistive',
}
const T1 = '2026-11-02T01:00:00.000Z'
const T2 = '2026-11-02T03:30:00.000Z'
const comment = (
  id: string,
  by: Stamp,
  body: string,
  at = T1,
  more: Partial<ReportComment> = {},
): ReportComment => ({ id, body, by, at, editedAt: null, deleted: false, ...more })
const thread = (
  id: string,
  anchor: CommentAnchor,
  comments: ReportComment[],
  more: Partial<CommentThread> = {},
): CommentThread => ({
  id,
  anchor,
  detached: false,
  status: 'open',
  resolved: null,
  comments,
  createdBy: comments[0].by,
  createdAt: comments[0].at,
  updatedAt: comments[0].at,
  ...more,
})

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// The gateway's comment threads, as a small in-memory store, and every
// request made of it.
let threads: CommentThread[] = []
type Call = { method: string; url: string; body: Record<string, unknown> | undefined }
const calls: Call[] = []
const me = () => (testAuth.role === 'knowledge_admin' ? SANA : ALEX)
let made = 0

function commentsAnswer(method: string, path: string, body: Record<string, unknown> = {}) {
  const find = (id: string) => threads.find((t) => t.id === id)!
  const replace = (t: CommentThread) => {
    threads = threads.map((x) => (x.id === t.id ? t : x))
    return t
  }
  if (method === 'GET' && path === '') return json(200, { threads })
  if (method === 'PUT' && path === '/anchors') return json(200, { updated: 1 })
  made += 1
  if (method === 'POST' && path === '') {
    const created = thread(`t${made}`, body.anchor as CommentAnchor, [
      comment(`c${made}`, me(), String(body.body), T2),
    ])
    threads = [...threads, created]
    return json(201, { thread: created })
  }
  const [, id, action, commentId] = path.split('/')
  const t = find(id)
  if (method === 'POST' && action === 'replies') {
    const reply = comment(`c${made}`, me(), String(body.body), T2)
    return json(201, { thread: replace({ ...t, comments: [...t.comments, reply] }) })
  }
  if (method === 'PATCH') {
    const comments = t.comments.map((c) =>
      c.id === commentId ? { ...c, body: String(body.body), editedAt: T2 } : c,
    )
    return json(200, { thread: replace({ ...t, comments }) })
  }
  if (method === 'DELETE') {
    const index = t.comments.findIndex((c) => c.id === commentId)
    const comments =
      index === 0
        ? t.comments.map((c, i) => (i === 0 ? { ...c, body: '', deleted: true } : c))
        : t.comments.filter((c) => c.id !== commentId)
    return json(200, { thread: replace({ ...t, comments }) })
  }
  if (method === 'POST' && action === 'resolve')
    return json(200, {
      thread: replace({ ...t, status: 'resolved', resolved: { by: me(), at: T2 } }),
    })
  if (method === 'POST' && action === 'reopen')
    return json(200, { thread: replace({ ...t, status: 'open', resolved: null }) })
  return json(404, { error: 'Not here' })
}

function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })
    if (url.startsWith(COMMENTS)) return commentsAnswer(method, url.slice(COMMENTS.length), body)
    if (method === 'PUT' && url.endsWith('/document'))
      return json(200, {
        version: body.baseVersion + 1,
        draftId: body.draftId,
        document: body.document,
        savedAt: '2026-11-05T02:30:00.000Z',
        savedBy: ALEX,
      })
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/review`) return json(200, WORKSPACE)
    if (url === `/api/assessments/${REF}/sections`) return json(200, LISTED)
    if (url === `/api/assessments/${REF}/summary`) return json(200, SUMMARY)
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    return json(200, [])
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  threads = []
  calls.length = 0
})

async function openReview(role: 'risk_engineer' | 'knowledge_admin' = 'risk_engineer') {
  mockGateway()
  // A knowledge admin starts on the knowledge base; the work list is a click away.
  window.history.replaceState(null, '', '/assessments')
  render(<App />)
  await signIn(role)
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }))
}

async function openDocument(role: 'risk_engineer' | 'knowledge_admin' = 'risk_engineer') {
  await openReview(role)
  const name = role === 'risk_engineer' ? 'Edit document' : 'Open document'
  fireEvent.click(await screen.findByRole('button', { name }))
  await screen.findByRole('textbox', { name: 'Report document' }, { timeout: 10_000 })
  // The threads are read, and each placed on its passage.
  await waitFor(() => expect(calls.some((c) => c.url === COMMENTS)).toBe(true))
}

const page = () => screen.getByRole('textbox', { name: 'Report document' })
const editorOf = () => (page() as HTMLElement & { editor: Editor }).editor
const margin = () => screen.getByRole('complementary', { name: 'Comments beside the text' })
const panel = () => screen.getByRole('complementary', { name: 'Comments' })
const highlighted = () =>
  [...page().querySelectorAll('.dm-comment')].map((element) => element.textContent)
const cardOn = (quote: string) =>
  screen.findByRole('article', { name: `Comment thread on “${quote}”` })
// The document position just after some text.
function after(text: string) {
  let at = -1
  editorOf().state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text!.includes(text))
      at = pos + node.text!.indexOf(text) + text.length
  })
  return at
}
// The document range of some words, across the text nodes the marks split.
function rangeOf(words: string): { from: number; to: number } {
  const found: { from: number; to: number }[] = []
  editorOf().state.doc.descendants((node, pos) => {
    if (found.length || !node.isTextblock) return !found.length
    const at = node.textContent.indexOf(words)
    if (at !== -1) found.push({ from: pos + 1 + at, to: pos + 1 + at + words.length })
    return false
  })
  return found[0]
}
function select(words: string) {
  const { from, to } = rangeOf(words)
  act(() => {
    editorOf().commands.setTextSelection({ from, to })
  })
}
const commentButton = () => screen.getByRole('button', { name: /^Comment \(Ctrl\+Alt\+M\)/ })
const posted = (method: string, path = '') =>
  calls.filter((c) => c.method === method && c.url === `${COMMENTS}${path}`)

it('starts a thread on the selected text, in the margin beside it and highlighted (AC1)', async () => {
  await openDocument()
  // Nothing selected: Comment says why it can't be used yet.
  expect(commentButton()).toHaveAttribute('aria-disabled', 'true')

  select('not fire-stopped')
  fireEvent.click(commentButton())
  const box = within(margin()).getByRole('textbox', { name: 'New comment' })
  expect(page().querySelector('.dm-comment.is-draft')).toHaveTextContent('not fire-stopped')

  fireEvent.change(box, { target: { value: 'Is this still the case after the March works?' } })
  fireEvent.click(within(margin()).getByRole('button', { name: 'Comment' }))

  const card = await cardOn('not fire-stopped')
  expect(
    within(card).getByText('Is this still the case after the March works?'),
  ).toBeInTheDocument()
  expect(posted('POST')[0].body).toMatchObject({
    anchor: { sectionId: '7', exact: 'not fire-stopped' },
    body: 'Is this still the case after the March works?',
  })
  expect(highlighted()).toEqual(['not fire-stopped'])
  // A comment is not a change to the text: nothing waits to be saved.
  expect(screen.getByText('All changes saved')).toBeInTheDocument()
}, 20_000)

it("starts one from Comment's keyboard shortcut too (AC1)", async () => {
  await openDocument()
  select('roof')
  fireEvent.keyDown(page(), { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })
  expect(within(margin()).getByRole('textbox', { name: 'New comment' })).toBeInTheDocument()
  fireEvent.click(within(margin()).getByRole('button', { name: 'Cancel' }))
  expect(page().querySelector('.dm-comment')).toBeNull()
}, 20_000)

it('shows each reply under the thread with its author and time, oldest first (AC2)', async () => {
  threads = [
    thread('t1', ON_RISER, [
      comment('c1', ALEX, 'Is this still so?', T1),
      comment('c2', SANA, 'Yes, checked against the photos.', T2),
    ]),
  ]
  await openDocument()
  const folded = await cardOn('not fire-stopped')
  expect(within(folded).getByText('1 reply')).toBeInTheDocument()
  fireEvent.click(within(folded).getByRole('button'))

  const card = await cardOn('not fire-stopped')
  const items = within(card).getAllByRole('listitem')
  expect(items.map((item) => within(item).getByText(/Rowe|Patel/).textContent)).toEqual([
    'Alex Rowe',
    'Sana Patel',
  ])
  expect(items[0]).toHaveTextContent(formatDayTime(new Date(T1)))
  expect(items[1]).toHaveTextContent(formatDayTime(new Date(T2)))

  fireEvent.change(within(card).getByRole('textbox', { name: 'Reply' }), {
    target: { value: 'Thanks, noted in Section 7.' },
  })
  fireEvent.click(within(card).getByRole('button', { name: 'Reply' }))
  await waitFor(() => expect(within(card).getAllByRole('listitem')).toHaveLength(3))
  expect(within(card).getAllByRole('listitem')[2]).toHaveTextContent('Thanks, noted in Section 7.')
  expect(posted('POST', '/t1/replies')[0].body).toEqual({ body: 'Thanks, noted in Section 7.' })
}, 20_000)

it('lets me edit and delete only my own comments, and marks an edited one (AC3)', async () => {
  threads = [
    thread('t1', ON_RISER, [
      comment('c1', ALEX, 'Is this still so?', T1),
      comment('c2', SANA, 'Yes, checked against the photos.', T2),
    ]),
  ]
  await openDocument()
  fireEvent.click(within(await cardOn('not fire-stopped')).getByRole('button'))
  const card = await cardOn('not fire-stopped')
  // Only mine offers Edit and Delete.
  expect(within(card).getAllByRole('button', { name: 'Edit comment' })).toHaveLength(1)
  expect(within(card).getAllByRole('button', { name: 'Delete comment' })).toHaveLength(1)

  fireEvent.click(within(card).getByRole('button', { name: 'Edit comment' }))
  const box = within(card).getByRole('textbox', { name: 'Edit comment' })
  expect(box).toHaveValue('Is this still so?')
  fireEvent.change(box, { target: { value: 'Is this still so after the March works?' } })
  fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
  // Saved, the box gives way to the comment as edited. (The box itself holds
  // the same words until then, so the comment is looked for once it has gone.)
  await waitFor(() =>
    expect(within(card).queryByRole('textbox', { name: 'Edit comment' })).not.toBeInTheDocument(),
  )
  expect(
    within(card).getByText('Is this still so after the March works?', { selector: '.cm-body' }),
  ).toBeInTheDocument()
  expect(within(card).getByText('· Edited')).toBeInTheDocument()
  expect(posted('PATCH', '/t1/comments/c1')).toHaveLength(1)

  fireEvent.click(within(card).getByRole('button', { name: 'Delete comment' }))
  fireEvent.click(within(card).getByRole('button', { name: 'Delete' }))
  expect(await within(card).findByText('Comment deleted')).toBeInTheDocument()
  expect(within(card).getByText('Yes, checked against the photos.')).toBeInTheDocument()
  expect(posted('DELETE', '/t1/comments/c1')).toHaveLength(1)
}, 20_000)

it('resolves a thread, which leaves the margin and its highlight, and reopens it from the resolved threads (AC5)', async () => {
  threads = [thread('t1', ON_RISER, [comment('c1', SANA, 'Source for this?')])]
  await openDocument()
  await waitFor(() => expect(highlighted()).toEqual(['not fire-stopped']))
  fireEvent.click(within(await cardOn('not fire-stopped')).getByRole('button'))
  fireEvent.click(
    within(await cardOn('not fire-stopped')).getByRole('button', { name: 'Resolve thread' }),
  )

  await waitFor(() =>
    expect(screen.queryByRole('article', { name: /not fire-stopped/ })).not.toBeInTheDocument(),
  )
  expect(highlighted()).toEqual([])

  fireEvent.click(screen.getByRole('button', { name: /^Comments/ }))
  fireEvent.click(within(panel()).getByRole('radio', { name: 'Resolved' }))
  fireEvent.click(within(panel()).getByRole('button', { name: /not fire-stopped/ }))
  const card = await cardOn('not fire-stopped')
  expect(within(card).getByText(/Resolved by Alex Rowe/)).toBeInTheDocument()
  fireEvent.click(within(card).getByRole('button', { name: 'Reopen thread' }))
  await waitFor(() => expect(highlighted()).toEqual(['not fire-stopped']))
  expect(posted('POST', '/t1/reopen')).toHaveLength(1)
}, 20_000)

it('keeps a thread on what remains of its text as it is edited, and in the list once it is deleted (AC6)', async () => {
  threads = [thread('t1', ON_RISER, [comment('c1', SANA, 'Source for this?')])]
  await openDocument()
  await waitFor(() => expect(highlighted()).toEqual(['not fire-stopped']))

  act(() => {
    editorOf().commands.insertContentAt(after('not'), ' yet')
  })
  expect(highlighted()).toEqual(['not yet fire-stopped'])
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(posted('PUT', '/anchors')).toHaveLength(1))
  expect(posted('PUT', '/anchors')[0].body).toEqual({
    anchors: [
      {
        id: 't1',
        anchor: expect.objectContaining({ sectionId: '7', exact: 'not yet fire-stopped' }),
      },
    ],
  })

  act(() => {
    editorOf().commands.deleteRange(rangeOf('not yet fire-stopped'))
  })
  expect(highlighted()).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(posted('PUT', '/anchors')).toHaveLength(2))
  expect(posted('PUT', '/anchors')[1].body).toEqual({ anchors: [{ id: 't1', anchor: null }] })

  // Still listed, quoting the text it was on.
  fireEvent.click(screen.getByRole('button', { name: /^Comments/ }))
  const row = within(panel()).getByRole('button', { name: /not yet fire-stopped/ })
  expect(row).toHaveTextContent('Text deleted')
}, 30_000)

it('opens read only for a knowledge admin, who comments and replies but cannot change the text (AC7)', async () => {
  threads = [thread('t1', ON_RISER, [comment('c1', ALEX, 'Is this still so?')])]
  await openDocument('knowledge_admin')
  expect(page()).toHaveAttribute('contenteditable', 'false')
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Bold/ })).not.toBeInTheDocument()
  expect(screen.getByText('Read only · You can comment and reply')).toBeInTheDocument()

  select('roof')
  fireEvent.click(commentButton())
  fireEvent.change(within(margin()).getByRole('textbox', { name: 'New comment' }), {
    target: { value: 'Which standard sets this?' },
  })
  fireEvent.click(within(margin()).getByRole('button', { name: 'Comment' }))
  await cardOn('roof')
  expect(posted('POST')[0].body).toMatchObject({ anchor: { sectionId: '7', exact: 'roof' } })

  fireEvent.click(within(await cardOn('not fire-stopped')).getByRole('button'))
  const card = await cardOn('not fire-stopped')
  fireEvent.change(within(card).getByRole('textbox', { name: 'Reply' }), {
    target: { value: 'Yes.' },
  })
  fireEvent.click(within(card).getByRole('button', { name: 'Reply' }))
  await waitFor(() => expect(posted('POST', '/t1/replies')).toHaveLength(1))
  // Nothing of the text was saved.
  expect(calls.some((c) => c.method === 'PUT')).toBe(false)
}, 20_000)

it('lists every thread in report order, filtered by open or resolved; choosing one scrolls to it (AC8)', async () => {
  threads = [
    thread('t9', ON_VALVES, [comment('c9', SANA, 'Are these logged?', T1)]),
    thread('t7', ON_RISER, [comment('c7', SANA, 'Source for this?', T2)]),
    thread('tr', ON_ROOF, [comment('cr', SANA, 'Fine now.', T2)], {
      status: 'resolved',
      resolved: { by: SANA, at: T2 },
    }),
  ]
  await openDocument()
  fireEvent.click(screen.getByRole('button', { name: /^Comments/ }))
  const rows = () =>
    within(within(panel()).getByRole('list', { name: 'Comment threads' }))
      .getAllByRole('button')
      .map((row) => row.textContent)
  await waitFor(() => expect(rows()).toHaveLength(2))
  expect(rows()[0]).toMatch(/^7\. Construction.*not fire-stopped/)
  expect(rows()[1]).toMatch(/^9\. Fire Protection.*Valves/)

  fireEvent.click(within(panel()).getByRole('radio', { name: 'Resolved' }))
  expect(rows()).toEqual([expect.stringMatching(/roof.*Fine now/)])
  fireEvent.click(within(panel()).getByRole('radio', { name: 'All' }))
  expect(rows().map((r) => r!.slice(0, 5))).toEqual(['7. Co', '7. Co', '9. Fi'])

  const scrolled = vi.mocked(Element.prototype.scrollIntoView)
  scrolled.mockClear()
  fireEvent.click(within(panel()).getByRole('button', { name: /Valves/ }))
  expect(scrolled).toHaveBeenCalled()
  const card = await cardOn('Valves')
  expect(within(card).getByRole('textbox', { name: 'Reply' })).toBeInTheDocument()
}, 20_000)
