import request from 'supertest'
import type { Express } from 'express'
import { Types } from 'mongoose'
import { signSession } from '../services/auth.service'
import { SESSION_COOKIE } from '../middleware/auth.middleware'
import type { IUser, UserRole } from '../models/user.model'

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

// Mints a real session token for a seeded test user and returns request
// helpers that carry it, so route tests don't hand-roll cookies. Signs
// directly rather than hitting /login, so tests don't need a real password.
export function signedInAs(app: Express, user: IUser & { _id: unknown }) {
  const cookie = `${SESSION_COOKIE}=${signSession(user)}`
  const withCookie = (method: Method) => (url: string) =>
    request(app)[method](url).set('Cookie', cookie)
  return {
    get: withCookie('get'),
    post: withCookie('post'),
    put: withCookie('put'),
    patch: withCookie('patch'),
    delete: withCookie('delete'),
  }
}

// The same, for a session with just a role (F-05). Sessions are checked from
// the signed token alone, so no account has to exist in the database — route
// tests can make one at module level and keep using it after each test
// empties the collections.
export function signedInAsRole(app: Express, role: UserRole, name = 'Test User') {
  const user = { _id: new Types.ObjectId(), role, name }
  return signedInAs(app, user as unknown as IUser & { _id: unknown })
}
