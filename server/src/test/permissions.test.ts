import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { UserModel } from '../models/user.model'
import {
  hasPermission,
  permissionsFor,
  ROLE_PERMISSIONS,
  type Permission,
} from '../services/permissions.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole, signedInAs } from './auth-test-helpers'

useMemoryMongo()

// Role permissions (F-05): the agreed matrix, enforced on every API route.
const engineer = signedInAsRole(app, 'risk_engineer', 'Jide Okafor')
const admin = signedInAsRole(app, 'knowledge_admin', 'Sana Patel')

const ID = '6ab39017e45cf009e4507731'

// Every protected route with the permission it needs. The routes check the
// permission before reading the body or the database, so an empty request is
// enough to see the gate.
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
const ROUTES: [method: Method, url: string, permission: Permission][] = [
  ['get', '/api/assessments', 'assessments:view'],
  ['get', '/api/assessments/engineers', 'assessments:edit'],
  ['post', '/api/assessments', 'assessments:edit'],
  ['post', '/api/assessments/RPT-2026-0411/capture-session', 'assessments:edit'],
  ['put', '/api/assessments/RPT-2026-0411', 'assessments:edit'],
  ['post', '/api/assessments/RPT-2026-0411/archive', 'assessments:edit'],
  ['post', '/api/assessments/RPT-2026-0411/restore', 'assessments:edit'],
  ['get', '/api/assessments/RPT-2026-0411/locations', 'assessments:view'],
  ['post', '/api/assessments/RPT-2026-0411/evaluation', 'reports:generate'],
  ['get', '/api/assessments/RPT-2026-0411/evaluation', 'assessments:view'],
  ['post', '/api/assessments/RPT-2026-0411/locations', 'assessments:edit'],
  ['delete', `/api/assessments/RPT-2026-0411/locations/${ID}`, 'assessments:edit'],
  ['get', '/api/assessments/RPT-2026-0411/observations', 'assessments:view'],
  ['post', '/api/assessments/RPT-2026-0411/observations', 'assessments:edit'],
  ['patch', `/api/observations/${ID}`, 'assessments:edit'],
  ['delete', `/api/observations/${ID}`, 'assessments:edit'],
  ['post', `/api/observations/${ID}/restore`, 'assessments:edit'],
  ['put', `/api/observations/${ID}/recordings/${ID}/transcript`, 'assessments:edit'],
  ['post', `/api/observations/${ID}/recordings/${ID}/transcription/retry`, 'assessments:edit'],
  ['get', `/api/observations/${ID}/recordings/${ID}/audio`, 'assessments:view'],
  ['post', '/api/rag/generate', 'reports:generate'],
  ['get', '/api/knowledge-documents', 'knowledge:view'],
  ['post', '/api/knowledge-documents', 'knowledge:manage'],
  ['get', `/api/knowledge-documents/${ID}/file`, 'knowledge:view'],
  ['get', '/api/knowledge-documents/ingested', 'knowledge:view'],
  ['put', `/api/knowledge-documents/${ID}`, 'knowledge:manage'],
  ['post', `/api/knowledge-documents/${ID}/retry`, 'knowledge:manage'],
  ['get', '/api/users', 'users:manage'],
  ['get', `/api/users/${ID}`, 'users:manage'],
  ['put', `/api/users/${ID}`, 'users:manage'],
]

const CASES = ROUTES.flatMap(([method, url, permission]) =>
  (['risk_engineer', 'knowledge_admin'] as const).map(
    (role) => [role, method, url, permission, hasPermission(role, permission)] as const,
  ),
)

describe('the permission matrix', () => {
  it('has exactly the two agreed roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['knowledge_admin', 'risk_engineer'])
  })

  it('gives a role outside the matrix nothing', () => {
    expect(permissionsFor('reviewer')).toEqual([])
    expect(hasPermission('reviewer', 'assessments:view')).toBe(false)
  })
})

describe('route permissions', () => {
  it.each(CASES)(
    '%s %s %s (%s) → allowed: %s',
    async (role, method: Method, url, _perm, allowed) => {
      const agent = role === 'risk_engineer' ? engineer : admin
      const response = await agent[method](url)

      if (allowed) {
        expect(response.status).not.toBe(401)
        expect(response.status).not.toBe(403)
      } else {
        expect(response.status).toBe(403)
        expect(response.body.error).toBe('Your role does not allow this.')
      }
    },
  )

  it.each(ROUTES)('%s %s needs a session (401)', async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401)
  })
})

// AC2: an allowed operation succeeds for its permitted role.
describe('allowed operations succeed', () => {
  it('lets a risk engineer create and list assessments', async () => {
    const user = await UserModel.create({
      staffId: 'TEST-1',
      name: 'Jide Okafor',
      email: 'jide@example.com',
      role: 'risk_engineer',
      active: true,
    })
    const assignedEngineer = signedInAs(app, user)
    const created = await assignedEngineer.post('/api/assessments').send({
      site: { name: 'Jurong Hub', jurisdiction: 'SG', facilityType: 'Distribution warehouse' },
      client: 'Straits Logistics',
      surveyType: 'Property risk survey',
      standards: [],
      engineerId: String(user._id),
    })
    expect(created.status).toBe(201)

    const list = await assignedEngineer.get('/api/assessments')
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
  })

  it('lets a knowledge admin read assessments, but not change them', async () => {
    const list = await admin.get('/api/assessments')
    expect(list.status).toBe(200)

    const created = await admin.post('/api/assessments').send({ client: 'Anything' })
    expect(created.status).toBe(403)
    expect(await AssessmentModel.countDocuments()).toBe(0)
  })

  it('lets a knowledge admin assign roles, and refuses a risk engineer', async () => {
    const user = await UserModel.create({
      staffId: 'MRE-0002',
      name: 'Jide Okafor',
      email: 'jide.okafor@example.com',
      role: 'risk_engineer',
    })
    const profile = {
      name: 'Jide Okafor',
      email: 'jide.okafor@example.com',
      role: 'knowledge_admin',
      active: true,
    }

    const refused = await engineer.put(`/api/users/${user._id}`).send(profile)
    expect(refused.status).toBe(403)
    expect((await UserModel.findById(user._id).lean())?.role).toBe('risk_engineer')

    const saved = await admin.put(`/api/users/${user._id}`).send(profile)
    expect(saved.status).toBe(200)
    expect(saved.body.role).toBe('knowledge_admin')
  })

  it('lets both roles list knowledge documents', async () => {
    expect((await engineer.get('/api/knowledge-documents')).status).toBe(200)
    expect((await admin.get('/api/knowledge-documents')).status).toBe(200)
  })
})

describe('GET /api/auth/me', () => {
  it("returns the role's permissions for the client's route guard", async () => {
    const response = await admin.get('/api/auth/me')

    expect(response.status).toBe(200)
    expect(response.body.user).toMatchObject({ role: 'knowledge_admin', name: 'Sana Patel' })
    expect(response.body.permissions).toEqual([...ROLE_PERMISSIONS.knowledge_admin])
  })
})
