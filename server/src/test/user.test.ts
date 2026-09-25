import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { UserModel } from '../models/user.model'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

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
    role: 'reviewer',
    jobTitle: 'Senior risk engineer · Property',
    phone: '+65 6123 4567',
    office: 'MY',
    active: true,
    ...overrides,
  }
}

function save(id: string, body: unknown) {
  return request(app)
    .put(`/api/users/${id}`)
    .send(body as object)
}

describe('GET /api/users', () => {
  it('lists accounts by name', async () => {
    await seedUser()
    await seedUser({ staffId: 'MRE-0001', name: 'Alex Rowe', email: 'alex.rowe@example.com' })

    const response = await request(app).get('/api/users')

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

    const response = await request(app).get(`/api/users/${user._id}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: String(user._id), name: 'Jide Okafor' })
  })

  it.each(['6ab39017e45cf009e4507731', 'not-an-id'])('returns 404 for %s', async (id) => {
    const response = await request(app).get(`/api/users/${id}`)

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
      role: 'reviewer',
      jobTitle: 'Senior risk engineer · Property',
      phone: '+65 6123 4567',
      office: 'MY',
    })
    const reopened = await request(app).get(`/api/users/${user._id}`)
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
