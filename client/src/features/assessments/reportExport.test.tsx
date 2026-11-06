import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Assessment, ReviewWorkspace } from './api'
import { registerPendingSave } from './pendingSaves'
import { ReportExport } from './screens/ReportExport'

// The Export tab (EX-01). jsdom lays nothing out, so the export's pages are
// stood in for: the gateway gets a page and answers with the file.
const laidOut = vi.hoisted(() => ({ options: null as unknown }))
vi.mock('./document/export/ExportPages', async () => {
  const { useEffect, useRef } = await import('react')
  return {
    ExportPages: ({ onReady, options }: { onReady: (html: string) => void; options: unknown }) => {
      const once = useRef(false)
      useEffect(() => {
        if (once.current) return
        once.current = true
        laidOut.options = options
        onReady('<!doctype html><title>pages</title>')
      }, [onReady, options])
      return null
    },
  }
})

const REF = 'RPT-2026-0001'
const RECORD = {
  id: '6ab39003058299a45f20c9d4',
  reference: REF,
  client: 'Straits Logistics',
  clientId: null,
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: null,
  engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
  status: 'draft',
  captureStartedAt: null,
  createdAt: '2026-09-23T09:00:00.000Z',
  site: {
    id: 's1',
    code: 'SITE-0001',
    name: 'Jurong Distribution Hub',
    address: null,
    jurisdiction: 'SG',
    facilityType: 'Distribution warehouse',
    removed: false,
    change: { allowed: true, reason: null, assessments: 1 },
  },
} as Assessment
const WORKSPACE: ReviewWorkspace = {
  sections: [],
  parts: { '1': null, '2': null, '3': null, A: null },
  summary: { total: 0, pending: 0, accepted: 0, edited: 0, rejected: 0 },
  asOf: '2026-10-19T02:00:00.000Z',
}
const BLOCKER = {
  sectionId: '7',
  title: '7. Construction',
  reason: '2 findings are waiting for your decision.',
  where: 'review',
}
const NOT_SUMMARISED = {
  sectionId: '2',
  title: '2. Executive Summary',
  reason: 'It is not drafted yet. Draft it on Generation once Sections 3 to 12 are complete.',
  where: 'generation',
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

type Answer = (init?: RequestInit) => Promise<Response>
let blockers: unknown[] = []
// Comment threads still open (RV-03 AC9).
let openThreads = 0
const FILE: Answer = () =>
  Promise.resolve(
    new Response(new Blob(['%PDF-1.4']), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${REF} 2026-11-04.pdf"; filename*=UTF-8''${encodeURIComponent(`${REF} 2026-11-04.pdf`)}`,
      },
    }),
  )
let exportAnswer: Answer = FILE
const posted: unknown[] = []

beforeEach(() => {
  blockers = []
  openThreads = 0
  exportAnswer = FILE
  posted.length = 0
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const path = `/api/assessments/${REF}`
    if (url === `${path}/export` && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)))
      return exportAnswer(init)
    }
    if (url === `${path}/export`) return json(200, { blockers, openThreads })
    if (url === `${path}/appendix`)
      return json(200, { selected: [{ photoId: 'p1', caption: 'Pump room' }], available: [] })
    if (url === `${path}/review`) return json(200, WORKSPACE)
    if (url === `${path}/summary`) return json(200, null)
    if (url === `${path}/ofis`) return json(200, { suggestions: [], accepted: [] })
    return json(200, [])
  })
  URL.createObjectURL = vi.fn(() => 'blob:file')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const opened = { review: vi.fn(), generate: vi.fn() }
const screenFor = (canExport = true) =>
  render(
    <ReportExport
      reference={REF}
      assessment={RECORD}
      canExport={canExport}
      onReview={opened.review}
      onGenerate={opened.generate}
    />,
  )

it('exports the chosen format with the chosen parts, named by the gateway (AC1, AC6)', async () => {
  screenFor()
  await screen.findByText('Ready to export')
  fireEvent.click(screen.getByLabelText(/Word document/))
  fireEvent.click(screen.getByLabelText(/^Citations/))
  const button = screen.getByRole('button', { name: 'Export as Word' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  expect(await screen.findByText(`Downloaded ${REF} 2026-11-04.pdf.`)).toBeInTheDocument()
  expect(posted).toEqual([
    { format: 'docx', citations: false, photos: true, html: '<!doctype html><title>pages</title>' },
  ])
  expect(laidOut.options).toEqual({ citations: false, photos: true, appendixPhotos: 1 })
})

it('reminds of comment threads still open, without blocking the export (RV-03 AC9)', async () => {
  openThreads = 2
  screenFor()
  await screen.findByText('Ready to export')
  expect(screen.getByText('2 comment threads are still open')).toBeInTheDocument()
  const button = screen.getByRole('button', { name: 'Export as PDF' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  expect(await screen.findByText(`Downloaded ${REF} 2026-11-04.pdf.`)).toBeInTheDocument()
})

it('shows no reminder once every thread is resolved (RV-03 AC9)', async () => {
  screenFor()
  await screen.findByText('Ready to export')
  expect(screen.queryByText(/comment threads? (is|are) still open/)).not.toBeInTheDocument()
})

it('saves pending edits before exporting, and exports nothing if they fail (AC1)', async () => {
  const flush = vi.fn(async () => false)
  const unregister = registerPendingSave(flush)
  try {
    screenFor()
    await screen.findByText('Ready to export')
    fireEvent.click(screen.getByRole('button', { name: 'Export as PDF' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Nothing was exported')).toBeInTheDocument()
    expect(alert).toHaveTextContent('Your latest changes could not be saved')
    expect(flush).toHaveBeenCalled()
    expect(posted).toEqual([])
  } finally {
    unregister()
  }
})

it('lists what is left to finish, and offers no export until the report is complete (AC1)', async () => {
  blockers = [NOT_SUMMARISED, BLOCKER]
  screenFor()
  expect(await screen.findByText('Export blocked: 2 items left')).toBeInTheDocument()
  expect(screen.getByText('7. Construction')).toBeInTheDocument()
  expect(screen.getByText('2 findings are waiting for your decision.')).toBeInTheDocument()
  // Greyed out and explained, not hidden (design system v2).
  const button = screen.getByRole('button', { name: 'Export as PDF' })
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAccessibleDescription(/The report is not complete: 2 items are left/)
  fireEvent.click(button)
  expect(posted).toEqual([])
  // Each item opens where it is finished.
  fireEvent.click(screen.getByRole('button', { name: 'Open Generation for 2. Executive Summary' }))
  expect(opened.generate).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Open review for 7. Construction' }))
  expect(opened.review).toHaveBeenCalled()
})

it('shows what is left when the gateway refuses the export (AC1)', async () => {
  exportAnswer = () =>
    json(409, {
      error: 'The report cannot be exported until it is complete.',
      blockers: [BLOCKER],
    })
  screenFor()
  await screen.findByText('Ready to export')
  fireEvent.click(screen.getByRole('button', { name: 'Export as PDF' }))
  expect(await screen.findByText('2 findings are waiting for your decision.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export as PDF' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

it('exports nothing for anyone but the assigned engineer, and says why (AC2)', async () => {
  screenFor(false)
  await screen.findByText('Ready to export')
  const button = screen.getByRole('button', { name: 'Export as PDF' })
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAccessibleDescription(/Only the assessment's assigned engineer exports/)
  fireEvent.click(button)
  expect(posted).toEqual([])
  expect(screen.getByLabelText(/^Citations/)).toBeDisabled()
})

it('says why a file could not be made, and retries (AC11)', async () => {
  let calls = 0
  exportAnswer = () => {
    calls += 1
    return calls === 1
      ? json(503, { error: 'The export could not start its PDF engine (Chromium).' })
      : Promise.resolve(
          new Response(new Blob(['%PDF']), {
            status: 200,
            headers: { 'Content-Disposition': `attachment; filename="${REF} 2026-11-04.pdf"` },
          }),
        )
  }
  screenFor()
  await screen.findByText('Ready to export')
  fireEvent.click(screen.getByRole('button', { name: 'Export as PDF' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('The export could not start its PDF engine (Chromium).')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText(`Downloaded ${REF} 2026-11-04.pdf.`)).toBeInTheDocument()
})
