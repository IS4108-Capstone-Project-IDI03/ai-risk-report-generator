// A stand-in gateway for the New Assessment tests (CP-23): routes by
// "METHOD url", every call logged. Used by manualForm.test.tsx and
// clientDocuments.test.tsx.
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

export type Call = { method: string; url: string; body: unknown }
type Reply = (body: unknown) => Promise<Response> | Response
export const calls: Call[] = []

/** Returns a JSON response. */
export const json = (status: number, body: unknown = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// Installs the routes; an unknown one answers 404 so a missing mock shows.
export function gateway(routes: Record<string, Reply>) {
  calls.length = 0
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const raw = init?.body
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw
    calls.push({ method, url, body })
    const reply = routes[method + ' ' + url]
    return reply ? reply(body) : json(404, { error: 'No route ' + method + ' ' + url })
  })
}
/** Returns the calls made with a method and URL. */
export const sent = (method: string, url: string) =>
  calls.filter((c) => c.method === method && c.url === url)

export const CLIENTS = [
  { id: 'c1', name: 'Harbourline Properties', sites: 1, division: 'Logistics' },
]
export const SITES = [
  {
    id: 's1',
    code: 'SITE-0001',
    name: 'Jurong Cold Store',
    address: '8 Fishery Port Rd',
    jurisdiction: 'SG',
    facilityType: 'Cold store',
    latest: { reference: 'RPT-2026-0100', siteVisitDate: '2026-01-10', locations: 6, buildings: 1 },
  },
]
/** Returns an assessment as the gateway answers it. */
export const created = (reference: string, site = 'Tuas Distribution Centre') => ({
  id: 'id-' + reference,
  reference,
  client: 'Harbourline Properties',
  clientId: 'c1',
  surveyType: 'First survey',
  siteVisitDate: '2026-11-12',
  reportDueDate: '2026-11-26',
  engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
  status: 'not_started',
  captureStartedAt: null,
  createdAt: '2026-11-03T09:00:00.000Z',
  site: {
    id: 'site-' + reference,
    code: 'SITE-9',
    name: site,
    address: null,
    jurisdiction: 'SG',
    facilityType: 'Distribution warehouse',
    removed: false,
    change: { allowed: true, reason: null, assessments: 1 },
  },
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
