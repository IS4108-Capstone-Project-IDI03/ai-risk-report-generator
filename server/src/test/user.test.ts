import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import app from '../index'
import { UserModel } from '../models/user.model'
import { permissionsFor } from '../services/permissions.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs, signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

// A knowledge admin is allowed everything below (F-05); role limits are in permissions.test.ts.
const api = signedInAsRole(app, 'knowledge_admin')

async function seedUser(overrides: Record<string, unknown> = {}) {
  return UserModel.create({
    staffId: 'MRE-0002',
    name: 'Jide Okafor',
    email: 'jide.okafor@example.com',
    role: 'risk_engineer',
    jobTitle: 'Risk engineer · Property',
    office: 'SG',
    ...overrides,
  })
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Jide Okafor',
    email: 'jide.okafor@example.com',
    role: 'knowledge_admin',
    jobTitle: 'Senior risk engineer · Property',
    phone: '+65 6123 4567',
    office: 'MY',
    active: true,
    ...overrides,
  }
}

function save(id: string, body: unknown) {
  return api.put(`/api/users/${id}`).send(body as object)
}

describe('GET /api/users', () => {
  it('lists accounts by name', async () => {
    await seedUser()
    await seedUser({ staffId: 'MRE-0001', name: 'Alex Rowe', email: 'alex.rowe@example.com' })

    const response = await api.get('/api/users')

    expect(response.status).toBe(200)
    expect(response.body.map((u: { name: string }) => u.name)).toEqual(['Alex Rowe', 'Jide Okafor'])
    expect(response.body[1]).toMatchObject({
      staffId: 'MRE-0002',
      email: 'jide.okafor@example.com',
      role: 'risk_engineer',
      jobTitle: 'Risk engineer · Property',
      phone: null,
      office: 'SG',
      active: true,
    })
  })
})

describe('GET /api/users/:id', () => {
  it('returns one account', async () => {
    const user = await seedUser()

    const response = await api.get(`/api/users/${user._id}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: String(user._id), name: 'Jide Okafor' })
  })

  it.each(['6ab39017e45cf009e4507731', 'not-an-id'])('returns 404 for %s', async (id) => {
    const response = await api.get(`/api/users/${id}`)

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('The account was not found.')
  })
})

describe('PUT /api/users/:id', () => {
  it('saves the edited profile, which later reads return', async () => {
    const user = await seedUser()

    const saved = await save(String(user._id), profile({ email: ' Jide.Okafor@Example.com ' }))

    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({
      id: String(user._id),
      staffId: 'MRE-0002',
      email: 'jide.okafor@example.com',
      role: 'knowledge_admin',
      jobTitle: 'Senior risk engineer · Property',
      phone: '+65 6123 4567',
      office: 'MY',
    })
    const reopened = await api.get(`/api/users/${user._id}`)
    expect(reopened.body).toEqual(saved.body)
  })

  it('clears optional fields sent empty', async () => {
    const user = await seedUser({ phone: '+65 6123 4567' })

    const saved = await save(String(user._id), profile({ jobTitle: '', phone: '', office: '' }))

    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ jobTitle: null, phone: null, office: null })
    const stored = await UserModel.findById(user._id).lean()
    expect(stored).not.toHaveProperty('phone')
  })

  it('does not change the staff ID', async () => {
    const user = await seedUser()

    const saved = await save(String(user._id), profile({ staffId: 'MRE-9999' }))

    expect(saved.body.staffId).toBe('MRE-0002')
  })

  it.each([
    ['the name is blank', { name: '  ' }, 'name', 'Name is required.'],
    [
      'the email is malformed',
      { email: 'jide.okafor' },
      'email',
      'Enter an email address such as name@example.com.',
    ],
    ['the role is unknown', { role: 'superuser' }, 'role', 'Choose a role.'],
    // F-05 keeps two roles; the old third one is no longer assignable.
    ['the role is the retired reviewer', { role: 'reviewer' }, 'role', 'Choose a role.'],
    [
      'the phone has letters',
      { phone: 'call me' },
      'phone',
      'Phone may contain only digits, spaces, brackets, hyphens and a leading +.',
    ],
    [
      'the office is not a code',
      { office: 'Singapore' },
      'office',
      'Office must be a two-letter jurisdiction code, e.g. SG.',
    ],
  ])(
    'rejects the profile when %s, and changes nothing',
    async (_case, overrides, field, message) => {
      const user = await seedUser()

      const response = await save(String(user._id), profile(overrides))

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('The profile details are invalid.')
      expect(response.body.fields[field]).toBe(message)
      const stored = await UserModel.findById(user._id).lean()
      expect(stored).toMatchObject({ name: 'Jide Okafor', role: 'risk_engineer', office: 'SG' })
    },
  )

  it('rejects an email another account uses, against the email field', async () => {
    const user = await seedUser()
    await seedUser({ staffId: 'MRE-0001', name: 'Alex Rowe', email: 'alex.rowe@example.com' })

    const response = await save(String(user._id), profile({ email: 'alex.rowe@example.com' }))

    expect(response.status).toBe(409)
    expect(response.body.fields).toEqual({ email: 'Another account already uses this email.' })
    const stored = await UserModel.findById(user._id).lean()
    expect(stored?.email).toBe('jide.okafor@example.com')
  })

  it('returns 404 for an unknown account', async () => {
    const response = await save('6ab39017e45cf009e4507731', profile())

    expect(response.status).toBe(404)
    expect(await UserModel.countDocuments()).toBe(0)
  })
})

// Role assignment (F-05 AC1): a knowledge admin assigns either role, but not
// to themselves, so the last admin cannot lock everyone out.
describe('PUT /api/users/:id role assignment', () => {
  it('assigns each of the two roles', async () => {
    const user = await seedUser()

    for (const role of ['knowledge_admin', 'risk_engineer']) {
      const saved = await save(String(user._id), profile({ role }))
      expect(saved.status).toBe(200)
      expect(saved.body.role).toBe(role)
    }
  })

  it("refuses an admin's change to their own role or active flag", async () => {
    const admin = await seedUser({ role: 'knowledge_admin' })
    const self = signedInAs(app, admin)
    const own = (overrides: Record<string, unknown>) =>
      self.put(`/api/users/${admin._id}`).send(profile(overrides))

    const demoted = await own({ role: 'risk_engineer' })
    expect(demoted.status).toBe(400)
    expect(demoted.body.fields).toEqual({
      role: 'You cannot change your own role. Ask another knowledge admin.',
    })
    const deactivated = await own({ active: false })
    expect(deactivated.status).toBe(400)
    expect(deactivated.body.fields).toHaveProperty('active')

    // Their other details are still theirs to edit.
    expect((await own({ jobTitle: 'Knowledge lead' })).status).toBe(200)
    const stored = await UserModel.findById(admin._id).lean()
    expect(stored).toMatchObject({ role: 'knowledge_admin', active: true })
  })
})

// New accounts (F-08): a knowledge admin adds a team member with a name, work
// email and role; job title, phone and office are optional.
describe('POST /api/users', () => {
  function newAccount(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Priya Nair',
      email: 'priya.nair@example.com',
      role: 'risk_engineer',
      ...overrides,
    }
  }
  function create(body: unknown) {
    return api.post('/api/users').send(body as object)
  }

  it('saves an active account that the account list then includes', async () => {
    const created = await create(newAccount({ email: ' Priya.Nair@Example.com ' }))

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      name: 'Priya Nair',
      email: 'priya.nair@example.com',
      role: 'risk_engineer',
      jobTitle: null,
      phone: null,
      office: null,
      active: true,
    })
    expect(created.body.staffId).toMatch(/^MRE-\d{4}$/)
    const list = await api.get('/api/users')
    expect(list.body).toEqual([created.body])
  })

  it('saves the optional job title, phone and office when given', async () => {
    const created = await create(
      newAccount({ jobTitle: 'Risk engineer · Property', phone: '+65 6123 4567', office: 'SG' }),
    )

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      jobTitle: 'Risk engineer · Property',
      phone: '+65 6123 4567',
      office: 'SG',
    })
  })

  it('gives each account its own staff ID, skipping ones already in use', async () => {
    await seedUser({ staffId: 'MRE-0001', email: 'alex.rowe@example.com' })

    const first = await create(newAccount())
    const second = await create(newAccount({ email: 'tom.lee@example.com', name: 'Tom Lee' }))

    expect(first.body.staffId).not.toBe('MRE-0001')
    expect(second.body.staffId).not.toBe(first.body.staffId)
  })

  it('ignores a staff ID or active flag in the request', async () => {
    const created = await create(newAccount({ staffId: 'MRE-9999', active: false }))

    expect(created.status).toBe(201)
    expect(created.body.staffId).not.toBe('MRE-9999')
    expect(created.body.active).toBe(true)
  })

  it.each([
    ['the name is missing', { name: undefined }, 'name', 'Name is required.'],
    ['the email is missing', { email: undefined }, 'email', 'Email is required.'],
    [
      'the email is malformed',
      { email: 'priya.nair' },
      'email',
      'Enter an email address such as name@example.com.',
    ],
    ['the role is missing', { role: undefined }, 'role', 'Choose a role.'],
    ['the role is unknown', { role: 'superuser' }, 'role', 'Choose a role.'],
    [
      'the office is not a code',
      { office: 'Singapore' },
      'office',
      'Office must be a two-letter jurisdiction code, e.g. SG.',
    ],
  ])(
    'rejects the account when %s, and creates nothing',
    async (_case, overrides, field, message) => {
      const response = await create(newAccount(overrides))

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('The account details are invalid.')
      expect(response.body.fields[field]).toBe(message)
      expect(await UserModel.countDocuments()).toBe(0)
    },
  )

  it('reports each invalid field at once', async () => {
    const response = await create({ name: '', email: 'nope', role: 'superuser' })

    expect(response.status).toBe(400)
    expect(Object.keys(response.body.fields).sort()).toEqual(['email', 'name', 'role'])
  })

  it('rejects an email another account uses, against the email field', async () => {
    await seedUser()

    const response = await create(newAccount({ email: 'JIDE.OKAFOR@example.com' }))

    expect(response.status).toBe(409)
    expect(response.body.fields).toEqual({ email: 'Another account already uses this email.' })
    expect(await UserModel.countDocuments()).toBe(1)
  })

  it('is refused to a risk engineer', async () => {
    const engineer = signedInAsRole(app, 'risk_engineer')

    const response = await engineer.post('/api/users').send(newAccount())

    expect(response.status).toBe(403)
    expect(await UserModel.countDocuments()).toBe(0)
  })

  // F-08 AC4: the new employee sets a password with the reset link (F-06),
  // then signs in with the email and gets their role's permissions.
  it.each(['risk_engineer', 'knowledge_admin'] as const)(
    'lets a new %s set a password and sign in to their role',
    async (role) => {
      await create(newAccount({ role }))

      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      await request(app).post('/api/auth/request-reset').send({ email: 'priya.nair@example.com' })
      const token = spy.mock.calls
        .map((call) => String(call[0]))
        .find((line) => line.includes('[password reset]'))
        ?.match(/token: ([a-f0-9]+)/)?.[1]
      spy.mockRestore()
      expect(token).toBeTruthy()
      await request(app)
        .post('/api/auth/reset')
        .send({ token, password: 'a first password' })
        .expect(200)

      const signedIn = await request(app)
        .post('/api/auth/login')
        .send({ email: 'priya.nair@example.com', password: 'a first password' })

      expect(signedIn.status).toBe(200)
      expect(signedIn.body.user).toMatchObject({ name: 'Priya Nair', role })
      expect(signedIn.body.permissions).toEqual(permissionsFor(role))
    },
  )
})
