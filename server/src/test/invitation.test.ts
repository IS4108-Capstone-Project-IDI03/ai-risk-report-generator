import nodemailer from 'nodemailer'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import { UserModel } from '../models/user.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

// Invitations (F-08): a new account's owner is emailed a link to set their
// first password. It is its own flow, separate from the password reset (F-06).

const admin = signedInAsRole(app, 'knowledge_admin')
const HOUR = 60 * 60 * 1000
const PASSWORD = 'first-password-1'
const INVALID_LINK =
  'This invitation link is invalid, has expired or has already been used. Ask a knowledge admin to send you a new invitation.'

function newAccount(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Priya Nair',
    email: 'priya.nair@example.com',
    role: 'risk_engineer',
    ...overrides,
  }
}

function profile(overrides: Record<string, unknown> = {}) {
  return { ...newAccount(), jobTitle: '', phone: '', office: '', active: true, ...overrides }
}

// With no SMTP the server console is the only inbox: runs the action and
// reads the invitation code printed for that email, if any.
async function withConsoleInbox<R>(action: () => PromiseLike<R>, email = 'priya.nair@example.com') {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const response = await action()
    const token = log.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.startsWith(`[invitation] ${email} `))
      ?.match(/token: ([a-f0-9]+)/)?.[1]
    return { response, token }
  } finally {
    log.mockRestore()
  }
}

function addAccount(overrides: Record<string, unknown> = {}) {
  const account = newAccount(overrides)
  return withConsoleInbox(() => admin.post('/api/users').send(account), account.email)
}

function lookUp(token: string | undefined) {
  return request(app).post('/api/auth/invitation').send({ token })
}

function accept(token: string | undefined, password = PASSWORD) {
  return request(app).post('/api/auth/invitation/accept').send({ token, password })
}

function resend(id: string) {
  return withConsoleInbox(() => admin.post(`/api/users/${id}/invitation`))
}

afterEach(() => vi.useRealTimers())

describe('The invitation email (F-08)', () => {
  it('is sent when an account is added, with a link that names the account', async () => {
    const { response, token } = await addAccount()

    expect(response.status).toBe(201)
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(response.body.passwordSet).toBe(false)
    const lasts = Date.parse(response.body.invitationExpiresAt) - Date.now()
    expect(lasts).toBeGreaterThan(71 * HOUR)
    expect(lasts).toBeLessThanOrEqual(72 * HOUR)

    const opened = await lookUp(token)
    expect(opened.status).toBe(200)
    expect(opened.body).toEqual({ name: 'Priya Nair', email: 'priya.nair@example.com' })
    // Only a hash of the code is stored.
    const stored = await UserModel.findOne().select('+inviteTokenHash').lean()
    expect(stored?.inviteTokenHash).toBeTruthy()
    expect(stored?.inviteTokenHash).not.toBe(token)
  })

  it('sets the first password, after which the account shows as set up', async () => {
    const { token } = await addAccount()

    const before = await request(app)
      .post('/api/auth/login')
      .send({ email: 'priya.nair@example.com', password: PASSWORD })
    expect(before.status).toBe(401)

    const set = await accept(token)
    expect(set.status).toBe(200)
    expect(set.body.email).toBe('priya.nair@example.com')

    const after = await request(app)
      .post('/api/auth/login')
      .send({ email: 'priya.nair@example.com', password: PASSWORD })
    expect(after.status).toBe(200)
    const [listed] = (await admin.get('/api/users')).body
    expect(listed).toMatchObject({ passwordSet: true, invitationExpiresAt: null })
  })

  it.each([
    ['too short', 'short-1', 'Use at least 12 characters, including a number and a symbol.'],
    [
      'without a number',
      'no-numbers-here',
      'Use at least 12 characters, including a number and a symbol.',
    ],
    [
      'without a symbol',
      'no symbols here 1',
      'Use at least 12 characters, including a number and a symbol.',
    ],
    ['too long', `a1-${'x'.repeat(70)}`, 'Use 72 characters or fewer.'],
  ])('refuses a password %s and keeps the link open', async (_case, password, message) => {
    const { token } = await addAccount()

    const response = await accept(token, password)

    expect(response.status).toBe(400)
    expect(response.body.fields).toEqual({ password: message })
    expect((await lookUp(token)).status).toBe(200)
    const stored = await UserModel.findOne().select('+passwordHash').lean()
    expect(stored?.passwordHash).toBeUndefined()
  })

  it('works only once', async () => {
    const { token } = await addAccount()
    expect((await accept(token)).status).toBe(200)

    const again = await accept(token, 'another-password-2')

    expect(again.status).toBe(400)
    expect(again.body.error).toBe(INVALID_LINK)
    expect((await lookUp(token)).status).toBe(400)
  })

  it('expires after 72 hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { token } = await addAccount()

    vi.advanceTimersByTime(72 * HOUR + 60_000)

    const opened = await lookUp(token)
    expect(opened.status).toBe(400)
    expect(opened.body.error).toBe(INVALID_LINK)
    expect((await accept(token)).status).toBe(400)
  })

  it('stops working when the account is deactivated', async () => {
    const { response, token } = await addAccount()

    await admin
      .put(`/api/users/${response.body.id}`)
      .send(profile({ active: false }))
      .expect(200)

    expect((await lookUp(token)).status).toBe(400)
    expect((await accept(token)).status).toBe(400)
  })

  it('rejects a link that was never sent', async () => {
    expect((await lookUp('0'.repeat(64))).status).toBe(400)
    expect((await accept('0'.repeat(64))).status).toBe(400)
    expect((await lookUp(undefined)).status).toBe(400)
  })
})

// An invitation is not the password reset: neither code works in the other's
// place, and a reset request sends nothing to someone who has no password yet.
describe('Invitations and the password reset (F-08, F-06)', () => {
  it('sends no reset link to an account that has never had a password', async () => {
    await addAccount()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const response = await request(app)
      .post('/api/auth/request-reset')
      .send({ email: 'priya.nair@example.com' })

    expect(response.status).toBe(200)
    expect(log.mock.calls.flat().join(' ')).not.toContain('[password reset]')
    log.mockRestore()
  })

  it('does not accept an invitation code as a reset code', async () => {
    const { token } = await addAccount()

    const reset = await request(app).post('/api/auth/reset').send({ token, password: PASSWORD })

    expect(reset.status).toBe(400)
    expect((await accept(token)).status).toBe(200)
  })
})

describe('POST /api/users/:id/invitation (F-08)', () => {
  it('emails a new link and cancels the earlier one', async () => {
    const { response: created, token: first } = await addAccount()

    const { response, token: second } = await resend(created.body.id)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: created.body.id, passwordSet: false })
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
    expect((await lookUp(first)).status).toBe(400)
    expect((await lookUp(second)).status).toBe(200)
  })

  it('renews an invitation that has expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { response: created } = await addAccount()
    vi.advanceTimersByTime(73 * HOUR)
    // The admin's earlier session has long expired by now.
    const later = signedInAsRole(app, 'knowledge_admin')

    const { response, token } = await withConsoleInbox(() =>
      later.post(`/api/users/${created.body.id}/invitation`),
    )

    expect(Date.parse(response.body.invitationExpiresAt)).toBeGreaterThan(Date.now())
    expect((await accept(token)).status).toBe(200)
  })

  it('is refused once they have set a password', async () => {
    const { response: created, token } = await addAccount()
    await accept(token)

    const { response, token: sent } = await resend(created.body.id)

    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/already set a password/)
    expect(sent).toBeUndefined()
  })

  it('is refused for a deactivated account', async () => {
    const { response: created } = await addAccount()
    await admin
      .put(`/api/users/${created.body.id}`)
      .send(profile({ active: false }))
      .expect(200)

    const { response, token } = await resend(created.body.id)

    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/Reactivate it/)
    expect(token).toBeUndefined()
  })

  it('returns 404 for an unknown account', async () => {
    const { response } = await resend('6ab39017e45cf009e4507731')
    expect(response.status).toBe(404)
  })
})

// The admin corrects a mistyped email before the invitation is accepted.
describe('Correcting the email of an account still to be set up (F-08)', () => {
  it('cancels the link sent to the old address and invites the new one', async () => {
    const { response: created, token: misdirected } = await addAccount({
      email: 'priya.nair@exmaple.com',
    })

    const { response, token } = await withConsoleInbox(() =>
      admin.put(`/api/users/${created.body.id}`).send(profile()),
    )

    expect(response.status).toBe(200)
    expect(response.body.invitationExpiresAt).not.toBeNull()
    expect((await lookUp(misdirected)).status).toBe(400)
    expect((await lookUp(token)).body).toEqual({
      name: 'Priya Nair',
      email: 'priya.nair@example.com',
    })
  })

  it('sends nothing when other details change', async () => {
    const { response: created, token } = await addAccount()

    const { token: sent } = await withConsoleInbox(() =>
      admin.put(`/api/users/${created.body.id}`).send(profile({ jobTitle: 'Risk engineer' })),
    )

    expect(sent).toBeUndefined()
    expect((await lookUp(token)).status).toBe(200)
  })
})

// Real mail: with SMTP configured, the invitation is emailed. nodemailer is
// stubbed — a test must never reach a real mail server.
describe('Invitation email over SMTP (F-08)', () => {
  const sendMail = vi.fn()
  const original = { ...config.smtp, appUrl: config.appUrl }

  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({})
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never)
    config.smtp.host = 'smtp.test'
    config.smtp.from = 'Marsh Risk <sender@example.com>'
    config.appUrl = 'http://app.test'
  })
  afterEach(() => {
    Object.assign(config.smtp, original)
    config.appUrl = original.appUrl
    vi.restoreAllMocks()
  })

  it('emails the work email a link that carries the code, and keeps the code out of the logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const created = await admin.post('/api/users').send(newAccount())

    expect(created.status).toBe(201)
    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = sendMail.mock.calls[0][0]
    expect(mail).toMatchObject({
      to: 'priya.nair@example.com',
      from: 'Marsh Risk <sender@example.com>',
      subject: 'Set up your Marsh Risk Report Generator account',
    })
    expect(mail.text).toContain('Hello Priya Nair,')
    const code = mail.text.match(/http:\/\/app\.test\/\?invite=([a-f0-9]{64})/)?.[1]
    expect(code).toBeTruthy()
    expect(mail.text).not.toContain('?reset=')
    expect(log.mock.calls.flat().join(' ')).not.toContain(code)
    expect((await lookUp(code)).status).toBe(200)
  })

  it('still adds the account when the email fails, and lets the admin send it again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMail.mockRejectedValue(new Error('SMTP down'))

    const created = await admin.post('/api/users').send(newAccount())

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ passwordSet: false, invitationExpiresAt: null })

    const failed = await admin.post(`/api/users/${created.body.id}/invitation`)
    expect(failed.status).toBe(503)
    expect(failed.body.error).toBe(
      'The invitation email could not be sent. Try again in a few minutes.',
    )

    sendMail.mockResolvedValue({})
    const sent = await admin.post(`/api/users/${created.body.id}/invitation`)
    expect(sent.status).toBe(200)
    expect(sent.body.invitationExpiresAt).not.toBeNull()
  })
})
