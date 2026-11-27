// What the New assessment screens give the walkthroughs (F-12): the sample email goes down the
// upload path a chosen file takes, a real Create raises the signal each "other way" offer waits for,
// and a try-it's intake calls carry x-walkthrough.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { signal, onSignal } from '../walkthrough/signals'
import { NewAssessment } from './screens/NewAssessment'
import { calls, created, gateway, json } from './testKit'
import { chooseOption } from '../../design-system/components/forms/selectTestHelpers'

let tryIt: string | null = null
vi.mock('../walkthrough/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../walkthrough/engine')>()),
  tryItRunning: () => tryIt,
}))

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
const site = () => screen.getByRole('region', { name: 'Site 1' })
const open = (mode: 'form' | 'documents') =>
  render(<NewAssessment mode={mode} start={{}} onCreated={vi.fn()} onLeave={vi.fn()} />)

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
})
afterEach(() => {
  tryIt = null
})

describe('New assessment, for the walkthroughs', () => {
  it('adds the sample email like a chosen file, with the walkthrough header', async () => {
    tryIt = 'new-docs'
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/client-intakes': () => json(201, { id: 'i1', files: [] }),
      'POST /api/client-intakes/i1/read': () => new Promise(() => {}),
    })
    // Keeps each request's headers, which the stand-in gateway does not log.
    const headers: Record<string, unknown> = {}
    const gatewayFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      headers[url] = init?.headers
      return gatewayFetch(url, init)
    })
    open('documents')
    await act(async () => signal('sample-email-wanted'))
    const upload = calls.find((c) => c.url === '/api/client-intakes')!
    const sent = (upload.body as FormData).get('file') as File
    expect(sent.name).toBe('practice-email.eml')
    expect(await sent.text()).toContain('Lumen Quay Provisions')
    // The upload and the read both say which walkthrough they belong to.
    expect(headers['/api/client-intakes']).toEqual({ 'x-walkthrough': 'new-docs' })
    expect(headers['/api/client-intakes/i1/read']).toEqual({ 'x-walkthrough': 'new-docs' })
  })

  it('raises assessment-created-by-form after a real Create', async () => {
    const heard = vi.fn()
    const stop = onSignal('assessment-created-by-form', heard)
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/assessments': () => json(201, { clientId: 'c9', assessments: [created('R1')] }),
    })
    open('form')
    type(screen.getByLabelText(/^Client name/), 'Pacific Crest REIT')
    type(within(site()).getByLabelText(/^Site name/), 'Tuas Hub')
    chooseOption(/^Facility type/, 'Distribution warehouse', site())
    type(within(site()).getByLabelText(/^Address/), '21 Tuas South Ave 3')
    expect(heard).not.toHaveBeenCalled()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Create' })))
    expect(heard).toHaveBeenCalledTimes(1)
    stop()
  })
})
