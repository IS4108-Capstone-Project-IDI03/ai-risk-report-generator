import request from 'supertest'
import type { Express } from 'express'
import { signSession } from '../services/auth.service'
import { SESSION_COOKIE } from '../middleware/auth.middleware'
import type { IUser } from '../models/user.model'

// Mints a real session token for a seeded test user and returns request
// helpers that carry it, so route tests don't hand-roll cookies. Signs
// directly rather than hitting /login, so tests don't need a real password.
export function signedInAs(app: Express, user: IUser & { _id: unknown }) {
  const cookie = `${SESSION_COOKIE}=${signSession(user)}`
  const withCookie = (method: 'get' | 'post' | 'put' | 'delete') => (url: string) =>
    request(app)[method](url).set('Cookie', cookie)
  return {
    get: withCookie('get'),
    post: withCookie('post'),
    put: withCookie('put'),
    delete: withCookie('delete'),
  }
}
