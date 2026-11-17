import bcrypt from 'bcrypt'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { UserModel } from '../models/user.model'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// S-01 AC2: a signed-in person changes their own password with the current one.
useMemoryMongo()

const CURRENT = 'current-pass-1!'
const NEXT = 'brand-new-pass-2@'
const URL = '/api/auth/change-password'

async function seedUser() {
  return UserModel.create({
    staffId: 'MRE-0010',
    name: 'Alex Rowe',
    email: 'alex.change@example.com',
    role: 'risk_engineer',
    passwordHash: await bcrypt.hash(CURRENT, 10),
  })
}

describe('POST /api/auth/change-password (S-01 AC2)', () => {
  it('changes the password when the current one is right, and the new one signs in', async () => {
    const user = await seedUser()
    const res = await signedInAs(app, user)
      .post(URL)
      .send({ currentPassword: CURRENT, newPassword: NEXT })
    expect(res.status).toBe(200)
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: NEXT })
    expect(login.status).toBe(200)
    const old = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: CURRENT })
    expect(old.status).toBe(401)
  })

  it('refuses a wrong current password with a field message, and changes nothing', async () => {
    const user = await seedUser()
    const res = await signedInAs(app, user)
      .post(URL)
      .send({ currentPassword: 'not-it', newPassword: NEXT })
    // 400, not 401: the client treats 401 as "session ended" and signs the person out.
    expect(res.status).toBe(400)
    expect(res.body.fields.currentPassword).toBeTruthy()
    const stored = await UserModel.findById(user._id).select('+passwordHash')
    expect(await bcrypt.compare(CURRENT, stored!.passwordHash!)).toBe(true)
  })

  it('refuses a new password that breaks the rules', async () => {
    const user = await seedUser()
    const res = await signedInAs(app, user)
      .post(URL)
      .send({ currentPassword: CURRENT, newPassword: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.fields.newPassword).toBeTruthy()
  })

  it('refuses a new password equal to the current one', async () => {
    const user = await seedUser()
    const res = await signedInAs(app, user)
      .post(URL)
      .send({ currentPassword: CURRENT, newPassword: CURRENT })
    expect(res.status).toBe(400)
    expect(res.body.fields.newPassword).toMatch(/different/i)
  })

  it('needs a signed-in session', async () => {
    const res = await request(app).post(URL).send({ currentPassword: CURRENT, newPassword: NEXT })
    expect(res.status).toBe(401)
  })

  it('locks after repeated wrong current passwords, like sign-in does', async () => {
    const user = await seedUser()
    const who = signedInAs(app, user)
    for (let i = 0; i < 5; i++) {
      await who.post(URL).send({ currentPassword: `wrong-${i}`, newPassword: NEXT })
    }
    // Even the right password is refused while locked.
    const res = await who.post(URL).send({ currentPassword: CURRENT, newPassword: NEXT })
    expect(res.status).toBe(429)
  })
})
