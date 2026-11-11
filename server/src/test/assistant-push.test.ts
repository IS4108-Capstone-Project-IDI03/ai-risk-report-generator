// MarshBot's push (AS-06 test seam 2): a change made in one request reaches an
// open Overview's event stream without polling, and the recheck middleware
// queues a check only after a successful change. The brief's own re-check
// (S1's recheck.service) is stubbed to announce the change, as it does after saving.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import jwt from 'jsonwebtoken'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { signSession } from '../services/auth.service'
import { recheckAssessment } from '../services/assistant/recheck.service'
import { drainInlineJobs } from '../services/job-queue.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

vi.mock('../services/assistant/recheck.service', () => ({
  recheckAssessment: vi.fn(async (reference: string) => {
    const { publishBriefChanged } = await import('../services/assistant/bus')
    publishBriefChanged(reference, '2026-11-11T09:00:00.000Z')
  }),
}))

useMemoryMongo()

const REF = 'RPT-2026-0101'
let server: http.Server
let port: number

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise((resolve) => server.close(resolve)))
beforeEach(() => vi.mocked(recheckAssessment).mockClear())

async function account(role: 'risk_engineer' | 'knowledge_admin', n: number) {
  return UserModel.create({
    staffId: `T-${n}`,
    name: `User ${n}`,
    email: `u${n}@example.com`,
    role,
  })
}

// An assessment assigned to a new engineer; returns that engineer.
async function assessment() {
  const engineer = await account('risk_engineer', 1)
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Pasir Gudang Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Cold store',
  })
  await AssessmentModel.create({
    reference: REF,
    site: site._id,
    surveyType: 'First survey',
    engineer: engineer._id,
  })
  return engineer
}

// Opens the stream with a raw request: supertest buffers the body, so it would never see an event.
function openStream(token: string, reference = REF) {
  return new Promise<{ res: http.IncomingMessage; frames: string[] }>((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: `/api/assessments/${reference}/assistant/events`,
        headers: { Cookie: `session=${token}` },
      },
      (res) => {
        const frames: string[] = []
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => frames.push(chunk))
        resolve({ res, frames })
      },
    )
    req.on('error', reject)
  })
}

describe('the assistant event stream', () => {
  it('pushes a brief event when another request changes the assessment, without refreshing the session', async () => {
    const engineer = await assessment()
    const { res, frames } = await openStream(signSession(engineer))
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.headers['x-accel-buffering']).toBe('no')
    expect(res.headers['set-cookie']).toBeUndefined()

    await signedInAs(app, engineer)
      .put(`/api/assessments/${REF}`)
      .send({ surveyType: 'Resurvey' })
      .expect(204)

    await vi.waitFor(() =>
      expect(frames.join('')).toContain(
        'event: brief\ndata: {"updatedAt":"2026-11-11T09:00:00.000Z"}\n\n',
      ),
    )
    res.destroy()
  })

  it('ends the stream when the session expires', async () => {
    const engineer = await assessment()
    const shortLived = jwt.sign(
      { id: String(engineer._id), role: 'risk_engineer', name: 'E' },
      config.jwtSecret,
      {
        expiresIn: 1,
      },
    )
    const { res } = await openStream(shortLived)
    await new Promise((resolve) => res.on('end', resolve))
  })

  it("refuses an engineer who isn't assigned and an unknown assessment, and lets an admin in", async () => {
    await assessment()
    const other = await account('risk_engineer', 2)
    const admin = await account('knowledge_admin', 3)
    expect((await openStream(signSession(other))).res.statusCode).toBe(403)
    expect((await openStream(signSession(other), 'RPT-2026-9999')).res.statusCode).toBe(404)
    const { res } = await openStream(signSession(admin))
    expect(res.statusCode).toBe(200)
    res.destroy()
  })
})

describe('the recheck middleware', () => {
  // Lets the response's finish handler and any queued check run.
  const settled = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await drainInlineJobs()
  }

  it('queues a check after a successful change, not after a read or a refused change', async () => {
    const api = signedInAs(app, await assessment())

    await api.get(`/api/assessments/${REF}/observations`).expect(200)
    await api.put(`/api/assessments/${REF}`).send({ surveyType: 'Not a type' }).expect(400)
    await settled()
    expect(recheckAssessment).not.toHaveBeenCalled()

    await api.put(`/api/assessments/${REF}`).send({ surveyType: 'Resurvey' }).expect(204)
    await settled()
    expect(recheckAssessment).toHaveBeenCalledWith(REF)
  })
})
