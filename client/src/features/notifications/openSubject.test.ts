// Tests for where a notification takes you (F-10 criterion 6, "What goes where"): one
// function serves the bell and the Inbox. Each case listens for what the app listens for.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSubject } from './openSubject'
import type { Notification } from './api'
import { knowledgeTab } from '../knowledge-base/openTab'
import { siteWalkReview } from '../site-walk/openReview'
import { assessmentOpen, assessmentsStale } from '../assessments/openAssessment'

afterEach(() => {
  window.history.replaceState(null, '', '/')
  knowledgeTab.current = 'documents'
  knowledgeTab.request = null
  knowledgeTab.document = null
})

const note = (purpose: Notification['purpose'], context: Record<string, string> | null) =>
  ({
    id: 'n1',
    purpose,
    kind: 'inbox',
    message: 'm',
    details: null,
    context,
    read: false,
    done: false,
    doneAt: null,
    createdAt: '2026-11-05T09:00:00.000Z',
  }) satisfies Notification

// Collects the detail of every event of this name the app would receive.
function listen(name: string) {
  const seen: unknown[] = []
  const handler = (e: Event) => seen.push((e as CustomEvent).detail)
  window.addEventListener(name, handler)
  return { seen, stop: () => window.removeEventListener(name, handler) }
}

describe('openSubject', () => {
  it('opens an assigned assessment on its Overview', () => {
    const heard = listen(assessmentOpen.event)
    openSubject(note('assessment_assigned', { reference: 'RPT-2026-0009', assessmentId: 'a1' }))
    heard.stop()
    expect(heard.seen).toEqual([{ reference: 'RPT-2026-0009' }])
  })

  it.each(['site_walk_ready', 'site_walk_failed'] as const)(
    'opens the site walk review for %s',
    (purpose) => {
      const heard = listen(siteWalkReview.event)
      openSubject(note(purpose, { reference: 'RPT-2026-0009', walkId: 'w7' }))
      heard.stop()
      expect(heard.seen).toEqual([{ reference: 'RPT-2026-0009', walkId: 'w7' }])
    },
  )

  it('opens a new knowledge request on the Requests tab, on that request', () => {
    openSubject(note('knowledge_gap_request', { requestId: 'r1', question: 'q' }))
    expect(window.location.pathname).toBe('/admin/knowledge-base')
    expect(knowledgeTab).toMatchObject({ current: 'requests', request: 'r1' })
  })

  it('opens a document that needs review on its Review page', () => {
    openSubject(note('ingestion_status', { documentId: 'd9', status: 'needs_review' }))
    expect(window.location.pathname).toBe('/admin/knowledge-base/review/d9')
  })

  it('opens a failed document where its retry is, with that document marked', () => {
    openSubject(note('ingestion_status', { documentId: 'd9', status: 'failed' }))
    expect(window.location.pathname).toBe('/admin/knowledge-base')
    expect(knowledgeTab).toMatchObject({ current: 'add', document: 'd9' })
  })

  it('opens a finished document in the Documents list, with that document marked', () => {
    openSubject(note('ingestion_status', { documentId: 'd9', status: 'complete' }))
    expect(knowledgeTab).toMatchObject({ current: 'documents', document: 'd9' })
  })

  it('opens the Assessments list for an assessment moved away', () => {
    openSubject(note('assessment_moved', { reference: 'RPT-2026-0002', sender: 'Sana' }))
    expect(window.location.pathname).toBe('/assessments')
  })

  it('reads the list again for an assessment moved away, even when already on the list', () => {
    window.history.replaceState(null, '', '/assessments')
    const heard = listen(assessmentsStale.event)
    openSubject(note('assessment_moved', { reference: 'RPT-2026-0002', sender: 'Sana' }))
    heard.stop()
    expect(heard.seen).toHaveLength(1)
  })

  it('opens MarshBot for a closed request, as before', () => {
    openSubject(note('knowledge_gap_request', { requestId: 'r1', status: 'filled' }))
    expect(window.location.pathname).toBe('/ask')
  })

  it('does nothing for a notification with nowhere to go', () => {
    const push = vi.spyOn(window.history, 'pushState')
    openSubject(note('account_status', null))
    expect(push).not.toHaveBeenCalled()
    push.mockRestore()
  })
})
