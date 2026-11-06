// Tests for the already-handled check (F-10 round 3): which rows are checked, and what each
// answer says. The two read calls are faked; everything else resolves null with no call.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayError } from '../assessments/api'
import type { Notification } from '../notifications/api'

const docRead = vi.fn()
const requestRead = vi.fn()
vi.mock('../knowledge-base/api', () => ({
  getKnowledgeDocument: (...a: unknown[]) => docRead(...a),
  getKnowledgeRequest: (...a: unknown[]) => requestRead(...a),
}))
import { alreadyHandled } from './alreadyHandled'

const signal = new AbortController().signal
const by = { id: 'u1', name: 'Sana Patel' }
const at = '2026-11-05T01:40:00.000Z'
const who = { at, by }

const row = (purpose: Notification['purpose'], context: Notification['context']): Notification => ({
  id: 'n1',
  purpose,
  kind: 'inbox',
  message: 'm',
  details: null,
  context,
  read: false,
  done: false,
  createdAt: at,
})
const gap = (context: Record<string, string> = { requestId: 'r1' }) =>
  row('knowledge_gap_request', context)
const review = row('ingestion_status', { documentId: 'd1', status: 'needs_review' })
const failed = row('ingestion_status', { documentId: 'd1', status: 'failed' })
const doc = (over: Record<string, unknown>) => ({
  withdrawn: null,
  handled: null,
  unconfirmed: [],
  match: null,
  status: 'complete',
  ...over,
})
const notFound = () => Promise.reject(new GatewayError(404))

beforeEach(() => {
  docRead.mockReset()
  requestRead.mockReset()
})

describe('requests', () => {
  it.each([
    ['filled', 'Request already filled'],
    ['dismissed', 'Request already dismissed'],
  ])('%s says who and when', async (status, title) => {
    requestRead.mockResolvedValue({ status, closed: who })
    expect(await alreadyHandled(gap(), signal)).toEqual({ title, by, at })
  })
  it('open, deleted: null', async () => {
    requestRead.mockResolvedValue({ status: 'open', closed: null })
    expect(await alreadyHandled(gap(), signal)).toBeNull()
    requestRead.mockImplementation(notFound)
    expect(await alreadyHandled(gap(), signal)).toBeNull()
  })
  it('is not checked with a status or without a requestId', async () => {
    expect(await alreadyHandled(gap({ requestId: 'r1', status: 'filled' }), signal)).toBeNull()
    expect(await alreadyHandled(gap({}), signal)).toBeNull()
    expect(requestRead).not.toHaveBeenCalled()
  })
  it('another failure rejects', async () => {
    requestRead.mockRejectedValue(new GatewayError(null))
    await expect(alreadyHandled(gap(), signal)).rejects.toBeInstanceOf(GatewayError)
  })
})

describe('needs review', () => {
  it('deleted has no name', async () => {
    docRead.mockImplementation(notFound)
    expect(await alreadyHandled(review, signal)).toEqual({
      title: 'Document already deleted',
      by: null,
      at: null,
    })
  })
  it('withdrawn wins', async () => {
    docRead.mockResolvedValue(doc({ withdrawn: who, unconfirmed: ['title'] }))
    expect(await alreadyHandled(review, signal)).toEqual({
      title: 'Document already withdrawn',
      by,
      at,
    })
  })
  it('still needing review: null', async () => {
    docRead.mockResolvedValue(doc({ unconfirmed: ['title'] }))
    expect(await alreadyHandled(review, signal)).toBeNull()
  })
  it('reviewed uses handled', async () => {
    docRead.mockResolvedValue(doc({ handled: who }))
    expect(await alreadyHandled(review, signal)).toEqual({
      title: 'Document already reviewed',
      by,
      at,
    })
  })
  it('reviewed with no handled has no name', async () => {
    docRead.mockResolvedValue(doc({}))
    expect(await alreadyHandled(review, signal)).toEqual({
      title: 'Document already reviewed',
      by: null,
      at: null,
    })
  })
})

describe('failed', () => {
  it('deleted and withdrawn', async () => {
    docRead.mockImplementation(notFound)
    expect((await alreadyHandled(failed, signal))?.title).toBe('Document already deleted')
    docRead.mockReset()
    docRead.mockResolvedValue(doc({ withdrawn: who, status: 'failed' }))
    expect(await alreadyHandled(failed, signal)).toEqual({
      title: 'Document already withdrawn',
      by,
      at,
    })
  })
  it.each([
    ['failed', null],
    ['queued', 'Document already being retried'],
    ['processing', 'Document already being retried'],
    ['complete', 'Document already retried'],
    ['cancelled', 'Upload already cancelled'],
  ])('status %s', async (status, title) => {
    docRead.mockResolvedValue(doc({ status, handled: who }))
    const answer = await alreadyHandled(failed, signal)
    expect(answer).toEqual(title ? { title, by, at } : null)
  })
})

describe('other rows', () => {
  it('resolve null with no call', async () => {
    const others = [
      row('ingestion_status', { documentId: 'd1', status: 'complete' }),
      row('assessment_assigned', { reference: 'R1' }),
      row('site_walk_ready', { reference: 'R1' }),
    ]
    for (const n of others) expect(await alreadyHandled(n, signal)).toBeNull()
    expect(docRead).not.toHaveBeenCalled()
    expect(requestRead).not.toHaveBeenCalled()
  })
})
