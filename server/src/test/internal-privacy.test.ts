// GET /api/internal/knowledge-documents/:id/privacy (PV-05): the ingestion
// worker asks how to protect a document before it reads it. The gateway
// decides (the epic's Rule 1); the worker never reads PII_PROTECTION itself.
import { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import app from '../index'
import { config } from '../config'
import { ClientModel } from '../models/client.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const KEY = config.serviceApiKey
if (!KEY) throw new Error('SERVICE_API_KEY must be set for the internal privacy tests.')

afterEach(() => {
  config.piiProtection = 'off'
})

// A queued past report, as the upload leaves it.
async function storedReport() {
  const { insertedId } = await KnowledgeDocumentModel.collection.insertOne({
    status: 'queued',
    fileName: 'Cold store survey.pdf',
  })
  return String(insertedId)
}

// `null` sends no key at all.
const ask = (id: string, key: string | null = KEY!) => {
  const req = request(app).get(`/api/internal/knowledge-documents/${id}/privacy`)
  return key ? req.set('x-service-key', key) : req
}

describe('GET /api/internal/knowledge-documents/:id/privacy', () => {
  it('lists every name to mask when protection is on', async () => {
    config.piiProtection = 'required'
    await ClientModel.create({ name: 'Acme Pte Ltd', key: 'acme pte ltd' })

    const res = await ask(await storedReport())

    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
    expect(res.body).not.toHaveProperty('detect')
    expect(res.body.known_entities).toContainEqual({ type: 'CLIENT', names: ['Acme Pte Ltd'] })
  })

  it('says protection is off when it is', async () => {
    const res = await ask(await storedReport())

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: false, known_entities: [] })
  })

  it('refuses a caller without the service key', async () => {
    const id = await storedReport()

    expect((await ask(id, null)).status).toBe(401)
    expect((await ask(id, 'wrong')).status).toBe(401)
  })

  it('answers 404 for a document that does not exist', async () => {
    expect((await ask(new Types.ObjectId().toString())).status).toBe(404)
    expect((await ask('not-an-id')).status).toBe(404)
  })
})
