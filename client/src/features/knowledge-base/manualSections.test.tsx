// IN-18: entering a standard clause by clause. "Enter a standard manually" in
// Add documents starts a draft; its page lists the clauses, and the editor adds,
// changes and deletes them. The gateway is a stubbed fetch that keeps state.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { knowledgeTab } from './openTab'

const STANDARD = {
  issuingBody: 'NFPA',
  standardNumber: '13',
  sourceType: 'nfpa_standard',
  jurisdiction: 'all',
  facilityType: 'all',
  edition: '2025',
  effectiveDate: '2025-01-01',
  error: null,
  uploadedAt: '2026-11-19T03:00:00.000Z',
  history: [],
  unconfirmed: [],
  withdrawn: null,
  handled: null,
  match: null,
  newerEdition: null,
  reinstateBlockedBy: null,
  fileName: null,
  fileUrl: null,
  size: null,
}
const DRAFT = {
  ...STANDARD,
  id: 'nfpa13',
  title: 'NFPA 13 Installation of Sprinkler Systems',
  entryMethod: 'manual',
  status: 'draft',
}
const PUBLISHED = { ...DRAFT, id: 'nfpa20', title: 'NFPA 20 Fire Pumps', status: 'complete' }
const UPLOADED = {
  ...STANDARD,
  id: 'pdf',
  title: 'NFPA 25 Inspection',
  standardNumber: '25',
  entryMethod: 'upload',
  status: 'complete',
  fileName: 'nfpa-25.pdf',
  fileUrl: '/api/knowledge-documents/pdf/file',
  size: 2048,
}
const clause = (n: number, over: object = {}) => ({
  id: `s${n}`,
  seq: n,
  order: n * 10,
  clause: `8.${n}`,
  headings: ['Chapter 8 Installation'],
  text: `Clause ${n} text.`,
  images: [],
  indexed: true,
  indexError: null,
  checked: true,
  copiedFrom: null,
  updatedBy: { id: 'u1', name: 'Sana Patel' },
  updatedAt: `2026-11-19T0${n}:00:00.000Z`,
  ...over,
})

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// The gateway as these screens use it. `answer` lets a test decide one route's reply.
type Sent = { method: string; url: string; body: unknown }
function mockGateway({
  documents = [DRAFT, PUBLISHED, UPLOADED] as object[],
  sections = [] as ReturnType<typeof clause>[],
  answer = {} as Record<string, (body: unknown) => Promise<Response>>,
  // What /screenshots answers: the OCR's reading, or a status and error.
  screenshot = { text: 'Pipe size: 25 mm; Max spacing: 3.7 m', readError: null } as
    { text: string; readError: string | null } | { status: number; error: string },
} = {}) {
  const sent: Sent[] = []
  let next = sections.length + 1
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    // A screenshot's body is the image itself, recorded as its file name.
    const body =
      init?.body instanceof File
        ? init.body.name
        : init?.body
          ? JSON.parse(String(init.body))
          : null
    if (method !== 'GET') sent.push({ method, url, body })
    if (url.includes('/sections/screenshots?') && method === 'POST') {
      if ('status' in screenshot) return json(screenshot.status, { error: screenshot.error })
      const kind = new URL(url, 'http://x').searchParams.get('kind')
      const name = `0b7c7c3e-6d1b-4a6e-9a51-6a0f8c1e2f${String(sent.length).padStart(2, '0')}.png`
      return json(201, { key: `knowledge/nfpa13/sections/${name}`, kind, ...screenshot })
    }
    const key = `${method} ${url.replace(/\/s\d+/, '/:sid')}`
    for (const [route, reply] of Object.entries(answer)) if (key.endsWith(route)) return reply(body)
    if (url === '/api/knowledge-documents/ingested') return json(200, documents)
    const publish = url.match(/^\/api\/knowledge-documents\/([^/]+)\/publish$/)?.[1]
    if (publish && method === 'POST') {
      const doc = (documents as { id: string }[]).find((d) => d.id === publish)
      return json(200, { ...doc, status: 'complete' })
    }
    if (url === '/api/knowledge-documents/manual' && method === 'POST') {
      const created = { ...DRAFT, id: 'new', title: body.title, edition: body.edition }
      documents.push(created)
      return json(201, created)
    }
    const doc = url.match(/^\/api\/knowledge-documents\/([^/]+)/)?.[1]
    if (url.endsWith('/sections') && method === 'GET') return json(200, sections)
    if (url.endsWith('/sections') && method === 'POST') {
      const saved = clause(next, { ...body, id: `s${next}`, seq: next, order: next * 10 })
      next += 1
      sections.push(saved)
      return json(201, saved)
    }
    const sid = url.match(/\/sections\/([^/]+)$/)?.[1]
    if (sid && method === 'PUT') {
      const i = sections.findIndex((s) => s.id === sid)
      sections[i] = { ...sections[i], ...body, updatedAt: '2026-11-19T09:00:00.000Z' }
      return json(200, sections[i])
    }
    if (sid && method === 'DELETE') {
      sections.splice(
        sections.findIndex((s) => s.id === sid),
        1,
      )
      return json(204, null)
    }
    const reembed = url.match(/\/sections\/([^/]+)\/reembed$/)?.[1]
    if (reembed) {
      const i = sections.findIndex((s) => s.id === reembed)
      sections[i] = { ...sections[i], indexed: true, indexError: null }
      return json(200, sections[i])
    }
    if (doc && method === 'GET') {
      return json(200, (documents as { id: string }[]).find((d) => d.id === doc) ?? {})
    }
    if (url.startsWith('/api/knowledge-documents')) return json(200, [])
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  return { sent, sections }
}

async function openKnowledgeBase() {
  render(<App />)
  await signIn('knowledge_admin')
  fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])
}
async function openClauses(title: string, action = 'Continue editing') {
  await openKnowledgeBase()
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }))
  const details = screen.getByRole('region', { name: `Details of ${title}` })
  fireEvent.click(within(details).getByRole('button', { name: action }))
  return screen.findByRole('region', { name: 'Clauses' })
}
const editor = () => screen.getByRole('form', { name: /clause/i })
// A required field's label ends with its marker, so labels are matched from the start.
const field = (label: string) => new RegExp(`^${label}`)
const type = (label: string, value: string) =>
  fireEvent.change(within(editor()).getByLabelText(field(label)), { target: { value } })
// The heading trail's box, and its bubbles (ChipInput).
const trailBox = () => within(editor()).getByRole('combobox', { name: 'Heading trail' })
const bubbles = () =>
  within(within(editor()).getByRole('list', { name: 'Added to Heading trail' }))
    .queryAllByRole('listitem')
    .map((b) => b.textContent?.replace(/^›/, ''))
// Types each heading into the trail and presses Enter, one bubble each.
function trail(...headings: string[]) {
  fireEvent.focus(trailBox())
  for (const heading of headings) {
    fireEvent.change(trailBox(), { target: { value: heading } })
    fireEvent.keyDown(trailBox(), { key: 'Enter' })
  }
}

// Chooses an image for a screenshot of `kind` in the editor.
function attach(kind: string, name = 'table.png') {
  fireEvent.change(within(editor()).getByLabelText('Screenshot of a'), { target: { value: kind } })
  const file = new File(['png bytes'], name, { type: 'image/png' })
  fireEvent.change(within(editor()).getByLabelText('Add screenshot'), {
    target: { files: [file] },
  })
}

beforeAll(() => {
  // jsdom has no object URLs; the editor previews a new screenshot with one.
  URL.createObjectURL = () => 'blob:preview'
  URL.revokeObjectURL = () => undefined
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
  window.history.replaceState(null, '', '/')
  // The open tab outlives a render; each test starts on Documents.
  knowledgeTab.current = 'documents'
})

describe('starting a manual entry', () => {
  it('collects a standard’s details, creates the draft and opens its clauses', async () => {
    const { sent } = mockGateway()
    await openKnowledgeBase()
    fireEvent.click(screen.getByRole('tab', { name: 'Add documents' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Enter a standard manually' }))
    const dialog = screen.getByRole('dialog', { name: 'Enter a standard manually' })
    expect(within(dialog).queryByRole('option', { name: 'Marsh report' })).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(field('Source type')), {
      target: { value: 'nfpa_standard' },
    })
    fireEvent.change(within(dialog).getByLabelText(field('Standard number')), {
      target: { value: '72' },
    })
    fireEvent.change(within(dialog).getByLabelText(field('Title')), {
      target: { value: 'NFPA 72 Fire Alarm Code' },
    })
    fireEvent.change(within(dialog).getByLabelText(field('Edition')), { target: { value: '2025' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start entering' }))

    expect(await screen.findByRole('heading', { name: 'NFPA 72 Fire Alarm Code' })).toBeVisible()
    expect(window.location.pathname).toBe('/admin/knowledge-base/manual/new')
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: '/api/knowledge-documents/manual',
      body: { sourceType: 'nfpa_standard', standardNumber: '72', edition: '2025' },
    })
    expect(await screen.findByText(/No clauses yet/)).toBeInTheDocument()
  })

  it('offers the entry already being made of the same standard', async () => {
    const reason = 'NFPA 13 (2025) is already being entered. Continue editing that entry.'
    mockGateway({
      answer: {
        'POST /api/knowledge-documents/manual': () =>
          json(409, { error: reason, documentId: 'nfpa13' }),
      },
    })
    await openKnowledgeBase()
    fireEvent.click(screen.getByRole('tab', { name: 'Add documents' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Enter a standard manually' }))
    const dialog = screen.getByRole('dialog', { name: 'Enter a standard manually' })
    fireEvent.change(within(dialog).getByLabelText(field('Source type')), {
      target: { value: 'nfpa_standard' },
    })
    fireEvent.change(within(dialog).getByLabelText(field('Standard number')), {
      target: { value: '13' },
    })
    fireEvent.change(within(dialog).getByLabelText(field('Title')), {
      target: { value: 'NFPA 13' },
    })
    fireEvent.change(within(dialog).getByLabelText(field('Edition')), { target: { value: '2025' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start entering' }))

    expect(await within(dialog).findByText(reason)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue editing' }))
    expect(await screen.findByRole('heading', { name: DRAFT.title })).toBeVisible()
  })
})

describe('the clauses page', () => {
  it('opens from a draft’s Continue editing and a published entry’s Edit clauses, not a PDF’s', async () => {
    mockGateway({ sections: [clause(1)] })
    await openClauses(PUBLISHED.title, 'Edit clauses')
    fireEvent.click(screen.getByRole('button', { name: 'All documents' }))

    fireEvent.click(await screen.findByRole('button', { name: /^NFPA 25/ }))
    const details = screen.getByRole('region', { name: `Details of ${UPLOADED.title}` })
    expect(within(details).queryByRole('button', { name: /clauses/i })).not.toBeInTheDocument()
    expect(
      within(details).queryByRole('button', { name: 'Continue editing' }),
    ).not.toBeInTheDocument()
  })

  it('adds a clause, then lists it as ready', async () => {
    const { sent } = mockGateway()
    await openClauses(DRAFT.title)

    type('Clause number', '8.6.1')
    trail('Chapter 8 Installation', '8.6 Hangers')
    type('Text', 'Hangers shall be listed.')
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save clause' }))

    const list = screen.getByRole('region', { name: 'Clauses' })
    expect(await within(list).findByRole('button', { name: /^8\.6\.1/ })).toBeInTheDocument()
    expect(within(list).getByText('Ready')).toBeInTheDocument()
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      url: '/api/knowledge-documents/nfpa13/sections',
      body: {
        clause: '8.6.1',
        headings: ['Chapter 8 Installation', '8.6 Hangers'],
        text: 'Hangers shall be listed.',
        images: [],
      },
    })
    // Ready for the next clause.
    expect(within(editor()).getByLabelText(field('Clause number'))).toHaveValue('')
  })

  it('shows a clause that failed to embed, and Re-embed clears it', async () => {
    const { sent } = mockGateway({
      sections: [clause(1, { indexed: false, indexError: "Search couldn't be updated." })],
    })
    const list = await openClauses(DRAFT.title)

    expect(await within(list).findByText('Failed to embed')).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: 'Re-embed 8.1' }))

    expect(await within(list).findByText('Ready')).toBeInTheDocument()
    expect(sent.at(-1)?.url).toBe('/api/knowledge-documents/nfpa13/sections/s1/reembed')
  })

  it('changes a clause, sending the time it was loaded', async () => {
    const { sent } = mockGateway({ sections: [clause(1)] })
    const list = await openClauses(DRAFT.title)

    fireEvent.click(await within(list).findByRole('button', { name: /^8\.1/ }))
    expect(within(editor()).getByLabelText(field('Text'))).toHaveValue('Clause 1 text.')
    type('Text', 'Amended text.')
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save clause' }))

    await waitFor(() => expect(sent.at(-1)?.method).toBe('PUT'))
    expect(sent.at(-1)).toMatchObject({
      url: '/api/knowledge-documents/nfpa13/sections/s1',
      body: { text: 'Amended text.', updatedAt: '2026-11-19T01:00:00.000Z' },
    })
  })

  it('shows a clause number already used under the field', async () => {
    mockGateway({
      sections: [clause(1)],
      answer: {
        'POST /api/knowledge-documents/nfpa13/sections': () =>
          json(409, {
            error: 'Clause 8.1 already exists.',
            fields: { clause: 'Clause 8.1 already exists.' },
          }),
      },
    })
    await openClauses(DRAFT.title)

    type('Clause number', '8.1')
    type('Text', 'Again.')
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save clause' }))

    expect(await within(editor()).findByText('Clause 8.1 already exists.')).toBeInTheDocument()
  })

  it('says when someone else saved the clause first', async () => {
    const reason =
      'Someone else saved this clause since you opened it. Reload it to see their change.'
    mockGateway({
      sections: [clause(1)],
      answer: {
        'PUT /api/knowledge-documents/nfpa13/sections/:sid': () => json(409, { error: reason }),
      },
    })
    const list = await openClauses(DRAFT.title)
    fireEvent.click(await within(list).findByRole('button', { name: /^8\.1/ }))
    type('Text', 'Mine.')
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save clause' }))

    expect(await within(editor()).findByText(reason)).toBeInTheDocument()
    expect(within(editor()).getByLabelText(field('Text'))).toHaveValue('Mine.')
  })

  it('needs a clause number and some text before saving', async () => {
    const { sent } = mockGateway()
    await openClauses(DRAFT.title)

    fireEvent.click(within(editor()).getByRole('button', { name: 'Save clause' }))

    expect(within(editor()).getByText('Enter the clause number.')).toBeInTheDocument()
    expect(
      within(editor()).getByText('Enter the clause text, or add a screenshot.'),
    ).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('deletes a clause after asking', async () => {
    const { sent } = mockGateway({ sections: [clause(1), clause(2)] })
    const list = await openClauses(DRAFT.title)
    fireEvent.click(await within(list).findByRole('button', { name: /^8\.1/ }))

    fireEvent.click(within(editor()).getByRole('button', { name: 'Delete clause' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete clause 8.1?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(within(list).queryByRole('button', { name: /^8\.1 / })).not.toBeInTheDocument(),
    )
    expect(sent.at(-1)).toMatchObject({
      method: 'DELETE',
      url: '/api/knowledge-documents/nfpa13/sections/s1',
    })
    expect(await screen.findByText('Clause 8.1 deleted.')).toBeInTheDocument()
  })

  it('asks before dropping unsaved changes, and keeps them if you stay', async () => {
    mockGateway({ sections: [clause(1), clause(2)] })
    const list = await openClauses(DRAFT.title)
    fireEvent.click(await within(list).findByRole('button', { name: /^8\.1/ }))
    type('Text', 'Half typed')

    fireEvent.click(within(list).getByRole('button', { name: /^8\.2/ }))
    const ask = screen.getByRole('dialog', { name: 'Discard your changes?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))

    expect(within(editor()).getByLabelText(field('Text'))).toHaveValue('Half typed')

    fireEvent.click(within(list).getByRole('button', { name: /^8\.2/ }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Discard your changes?' })).getByRole('button', {
        name: 'Discard',
      }),
    )
    expect(within(editor()).getByLabelText(field('Text'))).toHaveValue('Clause 2 text.')
  })

  it('goes back to the documents', async () => {
    mockGateway()
    await openClauses(DRAFT.title)

    fireEvent.click(screen.getByRole('button', { name: 'All documents' }))

    expect(await screen.findByRole('heading', { name: 'All documents' })).toBeVisible()
  })
})

describe('screenshots of tables, formulas and pictures', () => {
  it('reads a screenshot, lets you correct its text, and saves both with the clause', async () => {
    const { sent } = mockGateway()
    await openClauses(DRAFT.title)
    type('Clause number', '8.6.1')
    trail('Chapter 8', '8.6 Hangers')
    type('Text', 'Hangers shall be spaced as in the table.')

    attach('table')

    const read = await within(editor()).findByLabelText(field('Text read from table 1'))
    expect(read).toHaveValue('Pipe size: 25 mm; Max spacing: 3.7 m')
    expect(sent[0]).toEqual({
      method: 'POST',
      url: '/api/knowledge-documents/nfpa13/sections/screenshots?kind=table&context=Chapter+8+%3E+8.6+Hangers',
      body: 'table.png',
    })
    expect(within(editor()).getByRole('img', { name: 'Table 1' })).toHaveAttribute(
      'src',
      'blob:preview',
    )
    fireEvent.change(read, { target: { value: 'Pipe size: 25 mm; Max spacing: 3.6 m' } })
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save clause' }))

    await waitFor(() => expect(sent.at(-1)?.url).toBe('/api/knowledge-documents/nfpa13/sections'))
    expect(sent.at(-1)?.body).toMatchObject({
      images: [
        {
          key: expect.stringMatching(/^knowledge\/nfpa13\/sections\/.+\.png$/),
          kind: 'table',
          text: 'Pipe size: 25 mm; Max spacing: 3.6 m',
        },
      ],
    })
  })

  it('says when OCR read nothing, so the text can be typed', async () => {
    const reason = "The image couldn't be read automatically. Type its text in, or try again."
    mockGateway({ screenshot: { text: '', readError: reason } })
    await openClauses(DRAFT.title)

    attach('formula')

    expect(await within(editor()).findByText(reason)).toBeInTheDocument()
    expect(within(editor()).getByLabelText(field('Text read from formula 1'))).toHaveValue('')
  })

  it('keeps a refused file out of the clause and says why', async () => {
    mockGateway({ screenshot: { status: 415, error: 'Add a PNG, JPG or WebP image.' } })
    await openClauses(DRAFT.title)

    attach('picture', 'diagram.gif')

    expect(await screen.findByText('Add a PNG, JPG or WebP image.')).toBeInTheDocument()
    expect(within(editor()).queryByRole('img')).not.toBeInTheDocument()
  })

  it('saves a clause that is only a screenshot, and drops one removed before saving', async () => {
    const { sent } = mockGateway()
    await openClauses(DRAFT.title)
    type('Clause number', 'Table 8.6.1')
    attach('table')
    await within(editor()).findByLabelText(field('Text read from table 1'))
    attach('picture', 'figure.png')
    await within(editor()).findByLabelText(field('Text read from picture 2'))

    fireEvent.click(within(editor()).getByRole('button', { name: 'Remove picture 2' }))
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save clause' }))

    await waitFor(() => expect(sent.at(-1)?.url).toBe('/api/knowledge-documents/nfpa13/sections'))
    const saved = sent.at(-1)?.body as { text: string; images: { kind: string }[] }
    expect(saved.text).toBe('')
    expect(saved.images.map((i) => i.kind)).toEqual(['table'])
  })

  it('shows a saved clause’s screenshots from the gateway', async () => {
    const key = 'knowledge/nfpa13/sections/0b7c7c3e-6d1b-4a6e-9a51-6a0f8c1e2f3a.png'
    mockGateway({
      sections: [clause(1, { images: [{ key, kind: 'table', text: 'Pipe: 25 mm' }] })],
    })
    const list = await openClauses(DRAFT.title)

    fireEvent.click(await within(list).findByRole('button', { name: /^8\.1/ }))

    expect(within(editor()).getByRole('img', { name: 'Table 1' })).toHaveAttribute(
      'src',
      `/api/knowledge-documents/nfpa13/sections/screenshots/${key.split('/').pop()}`,
    )
    expect(within(editor()).getByLabelText(field('Text read from table 1'))).toHaveValue(
      'Pipe: 25 mm',
    )
  })
})

// T16: Start from, the clause filter, and Publish on the clauses page.
const EARLIER_PDF = {
  ...UPLOADED,
  id: 'nfpa13-2022',
  title: 'NFPA 13 Installation of Sprinkler Systems',
  standardNumber: '13',
  edition: '2022',
}
const EARLIER_MANUAL = {
  ...PUBLISHED,
  id: 'nfpa13-2019',
  title: 'NFPA 13 (typed in)',
  standardNumber: '13',
  edition: '2019',
}

async function startDialog() {
  await openKnowledgeBase()
  fireEvent.click(screen.getByRole('tab', { name: 'Add documents' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Enter a standard manually' }))
  const dialog = screen.getByRole('dialog', { name: 'Enter a standard manually' })
  const set = (label: string, value: string) =>
    fireEvent.change(within(dialog).getByLabelText(field(label)), { target: { value } })
  return { dialog, set }
}

describe('starting from an earlier edition', () => {
  it('offers the same standard’s other editions in the knowledge base, and copies the one chosen', async () => {
    const { sent } = mockGateway({
      documents: [DRAFT, EARLIER_PDF, EARLIER_MANUAL, UPLOADED],
    })
    const { dialog, set } = await startDialog()
    set('Source type', 'nfpa_standard')
    set('Standard number', '13')
    set('Title', 'NFPA 13 Installation of Sprinkler Systems')
    set('Edition', '2026')

    const from = await within(dialog).findByLabelText(field('Start from'))
    expect(
      within(from)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'A blank entry',
      'NFPA 13 Installation of Sprinkler Systems (2022 edition)',
      'NFPA 13 (typed in) (2019 edition, entered manually)',
    ])
    fireEvent.change(from, { target: { value: 'nfpa13-2022' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start entering' }))

    await waitFor(() => expect(sent[0]?.body).toMatchObject({ copyFrom: 'nfpa13-2022' }))
  })

  it('asks for the standard number before offering editions', async () => {
    mockGateway({ documents: [EARLIER_PDF] })
    const { dialog, set } = await startDialog()
    set('Source type', 'nfpa_standard')

    expect(within(dialog).queryByLabelText(field('Start from'))).not.toBeInTheDocument()
  })
})

describe('working through the clauses', () => {
  const MIXED = () => [
    clause(1),
    clause(2, { checked: false, copiedFrom: { documentId: 'old', clause: '8.2' } }),
    clause(3, { indexed: false, indexError: 'down' }),
  ]

  it('filters the list to the clauses left to check or that failed to embed', async () => {
    mockGateway({ sections: MIXED() })
    const list = await openClauses(DRAFT.title)
    const show = await within(list).findByLabelText('Show')

    expect(
      within(show)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All clauses (3)', 'To check (1)', 'Failed to embed (1)'])
    fireEvent.change(show, { target: { value: 'unchecked' } })
    expect(
      within(list)
        .getAllByRole('button', { name: /^8\./ })
        .map((b) => b.textContent),
    ).toEqual([expect.stringMatching(/^8\.2/)])
    fireEvent.change(show, { target: { value: 'failed' } })
    expect(within(list).getByRole('button', { name: /^8\.3/ })).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: /^8\.1/ })).not.toBeInTheDocument()
  })

  it('keeps Publish greyed out, saying what is left, until every clause is ready', async () => {
    mockGateway({ sections: MIXED() })
    await openClauses(DRAFT.title)

    const publish = await screen.findByRole('button', { name: 'Publish' })

    expect(publish).toHaveAttribute('aria-disabled', 'true')
    expect(publish).toHaveAccessibleDescription(/1 clause is left to check and 1 failed to embed/)
  })

  it('says a draft with no clauses has nothing to publish yet', async () => {
    mockGateway()
    await openClauses(DRAFT.title)

    expect(await screen.findByRole('button', { name: 'Publish' })).toHaveAccessibleDescription(
      /Add at least one clause/,
    )
  })

  it('publishes a finished draft from its clauses page', async () => {
    const { sent } = mockGateway({ sections: [clause(1), clause(2)] })
    await openClauses(DRAFT.title)

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    expect(await screen.findByText(`${DRAFT.title} published.`)).toBeInTheDocument()
    expect(sent.at(-1)?.url).toBe('/api/knowledge-documents/nfpa13/publish')
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
  })

  it('offers no Publish once a manual entry is published', async () => {
    mockGateway({ sections: [clause(1)] })
    await openClauses(PUBLISHED.title, 'Edit clauses')

    await screen.findByRole('heading', { name: PUBLISHED.title })
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
  })
})

// T20: the heading trail as bubbles, with the headings already used at each level.
describe('the heading trail as bubbles', () => {
  const TREE = () => [
    clause(1, { clause: '8.1', headings: ['Chapter 8 Installation', '8.1 General'] }),
    clause(2, { clause: '8.6.1', headings: ['Chapter 8 Installation', '8.6 Hangers'] }),
    clause(3, { clause: '9.1', headings: ['Chapter 9 Hangers', '9.1 Support'] }),
  ]
  const offered = () =>
    within(within(editor()).getByRole('listbox', { name: 'Suggestions for Heading trail' }))
      .queryAllByRole('option')
      .map((o) => o.textContent)

  it('offers each level the headings used under the bubbles before it, not another chapter’s', async () => {
    mockGateway({ sections: TREE() })
    await openClauses(DRAFT.title)

    fireEvent.focus(trailBox())
    fireEvent.click(trailBox())
    expect(offered()).toEqual(['Chapter 8 Installation', 'Chapter 9 Hangers'])

    trail('Chapter 8 Installation')
    fireEvent.click(trailBox())
    expect(offered()).toEqual(['8.1 General', '8.6 Hangers'])
  })

  it('picks a suggested heading, and saves the bubbles as the headings', async () => {
    const { sent } = mockGateway({ sections: TREE() })
    await openClauses(DRAFT.title)
    type('Clause number', '8.6.2')
    type('Text', 'Hanger rods shall be steel.')

    trail('Chapter 8 Installation')
    fireEvent.change(trailBox(), { target: { value: 'hang' } })
    fireEvent.keyDown(trailBox(), { key: 'ArrowDown' })
    fireEvent.keyDown(trailBox(), { key: 'Enter' })
    expect(bubbles()).toEqual(['Chapter 8 Installation', '8.6 Hangers'])
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save clause' }))

    await waitFor(() => expect(sent.at(-1)?.method).toBe('POST'))
    expect(sent.at(-1)?.body).toMatchObject({
      headings: ['Chapter 8 Installation', '8.6 Hangers'],
    })
  })

  it('opens a saved clause with its bubbles, and Undo changes brings them back', async () => {
    mockGateway({ sections: TREE() })
    const list = await openClauses(DRAFT.title)
    fireEvent.click(await within(list).findByRole('button', { name: /^8\.6\.1/ }))
    expect(bubbles()).toEqual(['Chapter 8 Installation', '8.6 Hangers'])

    fireEvent.click(within(editor()).getByRole('button', { name: 'Remove heading 8.6 Hangers' }))
    expect(bubbles()).toEqual(['Chapter 8 Installation'])
    fireEvent.click(within(editor()).getByRole('button', { name: 'Undo changes' }))

    expect(bubbles()).toEqual(['Chapter 8 Installation', '8.6 Hangers'])
  })

  it('asks before dropping a change to the bubbles', async () => {
    mockGateway({ sections: TREE() })
    const list = await openClauses(DRAFT.title)
    fireEvent.click(await within(list).findByRole('button', { name: /^8\.6\.1/ }))

    fireEvent.click(within(editor()).getByRole('button', { name: 'Remove heading 8.6 Hangers' }))
    fireEvent.click(within(list).getByRole('button', { name: /^9\.1/ }))

    expect(screen.getByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument()
  })
})
