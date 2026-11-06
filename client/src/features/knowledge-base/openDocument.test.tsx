// Tests for opening a document from a notification row (F-10): the Documents list marks it,
// and a failed one opens Add documents, where its Retry is, with nothing marked.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { knowledgeTab } from './openTab'

beforeAll(() => {
  // jsdom has no native modal implementation.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  // jsdom has no scrollIntoView.
  Element.prototype.scrollIntoView = () => undefined
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
  Object.assign(knowledgeTab, { current: 'documents', request: null, document: null })
})

const doc = (id: string, over = {}) => ({
  id,
  title: `Standard ${id}`,
  edition: '2022',
  uploadedAt: '2026-10-15T00:00:00.000Z',
  sourceType: 'nfpa_standard',
  unconfirmed: [],
  withdrawn: null,
  match: null,
  status: 'complete',
  ...over,
})

function openKnowledgeAs(tab: string, documentId: string) {
  vi.stubGlobal('fetch', (url: string) => {
    if (url === '/api/knowledge-documents/ingested')
      return Promise.resolve(Response.json([doc('d1'), doc('d2')]))
    if (url.startsWith('/api/knowledge-documents'))
      return Promise.resolve(Response.json([doc('d3', { status: 'failed', error: 'boom' })]))
    if (url === '/api/knowledge-gaps') return Promise.resolve(Response.json({ requests: [] }))
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  Object.assign(knowledgeTab, { current: tab, document: documentId })
  window.history.replaceState(null, '', '/admin/knowledge-base')
  render(<App />)
  return signIn('knowledge_admin')
}

describe('Knowledge base: a document a notification opened', () => {
  it('marks the document in the Documents list', async () => {
    await openKnowledgeAs('documents', 'd2')
    const row = await waitFor(() => {
      const el = document.getElementById('document-d2')
      expect(el).not.toBeNull()
      return el!
    })
    expect(row).toHaveAttribute('data-focused')
    expect(document.getElementById('document-d1')).not.toHaveAttribute('data-focused')
  })

  it('opens a failed upload on Add documents, where Retry is, with nothing marked', async () => {
    await openKnowledgeAs('add', 'd3')
    expect(await screen.findByRole('button', { name: /Retry/ })).toBeVisible()
    expect(document.querySelector('[data-focused]')).toBeNull()
  })
})
