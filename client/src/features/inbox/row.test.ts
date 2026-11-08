// Tests for how a notification becomes an Inbox row (F-10, boards 01, 02 and 07): sender in
// grey, task in bold, detail in grey, the phone's shorter two lines, the icon and its colour,
// and the due date. Pure, so no screen is rendered.
import { describe, expect, it } from 'vitest'
import { rowOf } from './row'
import { formatBellWhen, formatInboxWhen } from '../notifications/formatWhen'
import type { Notification } from '../notifications/api'

const base = {
  id: 'n1',
  kind: 'inbox',
  details: null,
  read: false,
  done: false,
  createdAt: '2026-11-05T03:42:00.000Z',
} as const

const note = (
  purpose: Notification['purpose'],
  message: string,
  context: Record<string, string> | null,
  details: string | null = null,
): Notification => ({ ...base, purpose, message, context, details })

describe('rowOf', () => {
  it('lays out an assigned assessment: who sent it, the task, the client, the due date', () => {
    const row = rowOf(
      note('assessment_assigned', 'New assessment: Jurong Island Chemical Depot', {
        reference: 'RPT-2026-0009',
        assessmentId: 'a1',
        client: 'Harbourline Properties Pte Ltd',
        site: 'Jurong Island Chemical Depot',
        sender: 'Sana Patel',
        reportDue: '2027-02-28',
      }),
    )
    expect(row).toMatchObject({
      sender: 'Sana Patel',
      task: 'New assessment: Jurong Island Chemical Depot',
      detail: 'Harbourline Properties Pte Ltd',
      phoneTask: 'New assessment',
      phoneDetail: 'Jurong Island Chemical Depot',
      icon: 'clipboard-list',
      tone: 'blue',
      showsDue: true,
      due: '2027-02-28',
    })
  })

  it('has no due date when the assessment has none', () => {
    const row = rowOf(
      note('assessment_assigned', 'New assessment: Tuas', { site: 'Tuas', sender: 'S' }),
    )
    // The cell shows ("Not set") although there is no date.
    expect(row).toMatchObject({ showsDue: true, due: null })
  })

  it('lays out a site walk that is ready (violet mic) and one that failed (red mic)', () => {
    const ctx = { reference: 'RPT-1', walkId: 'w1', client: 'C', site: 'Pasir Gudang Cold Store' }
    const ready = rowOf(note('site_walk_ready', 'Review site walk: Pasir Gudang Cold Store', ctx))
    expect(ready).toMatchObject({
      sender: 'Site walk',
      detail: 'Your proposal is ready',
      phoneTask: 'Review site walk',
      phoneDetail: 'Pasir Gudang Cold Store',
      icon: 'mic',
      tone: 'violet',
    })
    const failed = rowOf(
      note('site_walk_failed', 'Retry site walk: Changi', { ...ctx, site: 'Changi' }),
    )
    expect(failed).toMatchObject({
      detail: "Couldn't read the recording",
      phoneTask: 'Retry site walk',
      phoneDetail: "Couldn't read the recording",
      icon: 'mic',
      tone: 'red',
      // The reason is the failure itself, so the word is red on both layouts.
      detailTone: 'red',
      phoneDetailTone: 'red',
    })
    expect(ready).toMatchObject({ detailTone: 'grey', phoneDetailTone: 'grey' })
  })

  it('lays out a knowledge request with who asked and the question', () => {
    const row = rowOf(
      note('knowledge_gap_request', 'New knowledge request', {
        requestId: 'r1',
        question: 'Which NFPA edition covers cold store insulation?',
        askedBy: 'Alex Rowe',
      }),
    )
    expect(row).toMatchObject({
      sender: 'Alex Rowe',
      task: 'Answer knowledge request',
      detail: 'Which NFPA edition covers cold store insulation?',
      icon: 'book-open',
      showsDue: false,
    })
  })

  it('lays out a document to review and one that failed, with the reason', () => {
    const review = rowOf(
      note(
        'ingestion_status',
        '"NFPA 13-2022" needs review.',
        { documentId: 'd1', status: 'needs_review' },
        'Possible newer edition of NFPA_13_2019',
      ),
    )
    expect(review).toMatchObject({
      sender: 'Knowledge base',
      task: 'Review document: NFPA 13-2022',
      detail: 'Possible newer edition of NFPA_13_2019',
      // Needs a look: amber tile and word, with the warning file icon (round 2, item 2).
      icon: 'file-warning',
      tone: 'amber',
      detailTone: 'amber',
      // The phone's short line is the document's title, which is never coloured.
      phoneDetailTone: 'grey',
    })
    const failed = rowOf(
      note('ingestion_status', '"FM_2.0_Apr_26" failed to ingest during OCR.', {
        documentId: 'd2',
        status: 'failed',
        stage: 'OCR',
      }),
    )
    expect(failed).toMatchObject({
      task: 'Retry document: FM_2.0_Apr_26',
      detail: 'Failed during OCR',
      tone: 'red',
      detailTone: 'red',
      phoneDetailTone: 'grey',
    })
  })

  it('treats a due date it cannot read as no due date, not "NaN NaN"', () => {
    const row = rowOf(note('assessment_assigned', 'New assessment: X', { reportDue: 'soon' }))
    expect(row).toMatchObject({ showsDue: true, due: null })
  })

  it('falls back to the message for a purpose it has no layout for', () => {
    const row = rowOf(note('account_status', 'Account changed', null, 'Role updated'))
    expect(row).toMatchObject({ task: 'Account changed', detail: 'Role updated', icon: 'bell' })
  })
})

describe('formatInboxWhen', () => {
  const now = new Date(2026, 10, 5, 15, 0)
  it('shows the time today, Yesterday, then the date', () => {
    expect(formatInboxWhen(new Date(2026, 10, 5, 11, 42).toISOString(), now)).toBe('11:42')
    expect(formatInboxWhen(new Date(2026, 10, 4, 23, 0).toISOString(), now)).toBe('Yesterday')
    expect(formatInboxWhen(new Date(2026, 10, 3, 9, 0).toISOString(), now)).toBe('3 Nov')
  })
})

describe('formatBellWhen', () => {
  const now = new Date(2026, 10, 5, 15, 0)
  it('shows Today or Yesterday with the time, then the date with the time (board 11)', () => {
    expect(formatBellWhen(new Date(2026, 10, 5, 9, 40).toISOString(), now)).toBe('Today, 09:40')
    expect(formatBellWhen(new Date(2026, 10, 4, 23, 5).toISOString(), now)).toBe('Yesterday, 23:05')
    expect(formatBellWhen(new Date(2026, 10, 3, 15, 10).toISOString(), now)).toBe('3 Nov, 15:10')
  })
})
