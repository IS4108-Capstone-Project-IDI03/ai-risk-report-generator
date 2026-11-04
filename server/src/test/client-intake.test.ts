// Client intakes (CP-23) through the HTTP routes: upload with type checks,
// reading (ingestion and rag-service stubbed), discard, Create with its ledger,
// the client's documents, and the daily cleanup. S3 is a map; services are a
// stubbed fetch.
import { Readable } from 'stream'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import { AssessmentModel } from '../models/assessment.model'
import { ClientDocumentModel } from '../models/client-document.model'
import { ClientIntakeModel } from '../models/client-intake.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { cleanupExpiredIntakes } from '../services/client-intake.service'
import * as storage from '../services/storage.service'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

const s3 = vi.hoisted(() => new Map<string, Buffer>())
// vi.fn, so a test can make one S3 call fail with mockRejectedValueOnce.
vi.mock('../services/storage.service', () => ({
  putObject: vi.fn(async (key: string, body: Buffer) => void s3.set(key, body)),
  getObjectStream: async (key: string, range?: { start: number; end: number }) =>
    Readable.from([range ? s3.get(key)!.subarray(range.start, range.end + 1) : s3.get(key)!]),
  deleteObject: vi.fn(async (key: string) => void s3.delete(key)),
  copyObject: vi.fn(async (from: string, to: string) => void s3.set(to, s3.get(from)!)),
}))

useMemoryMongo()

const engineer = (name: string, staffId: string) => ({
  _id: new Types.ObjectId(),
  staffId,
  name,
  email: `${staffId.toLowerCase()}@example.com`,
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const alex = engineer('Alex Rowe', 'TEST-1')
const jide = engineer('Jide Okafor', 'TEST-2')
const api = signedInAs(app, alex)
const jideApi = signedInAs(app, jide)

// Files as their first bytes make them.
const PDF = Buffer.from('%PDF-1.7\nrequest letter')
const DOCX = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('word/document.xml')])
const DOC = Buffer.concat([
  Buffer.from('d0cf11e0a1b11ae1', 'hex'),
  Buffer.from('WordDocument', 'utf16le'),
])
const MSG = Buffer.concat([
  Buffer.from('d0cf11e0a1b11ae1', 'hex'),
  Buffer.from('__properties_version1.0', 'utf16le'),
])
const EML = Buffer.from(
  'From: mei@example.com\r\nSubject: Survey request\r\n\r\nPlease survey Tuas.',
)
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('jpeg body')])

type Texts = { status: number; body: object }
const ingestion = vi.fn<(fileName: string, body: Buffer) => Texts>()
const rag = vi.fn<(body: Record<string, unknown>) => Texts>()
const converter = vi.fn<() => Texts | Buffer>()
const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(async () => {
  await UserModel.create([alex, jide])
  ingestion.mockImplementation((fileName) => ({
    status: 200,
    body: { documents: [{ name: fileName, text: `Text of ${fileName}` }] },
  }))
  rag.mockImplementation(() => ({ status: 200, body: proposal() }))
  converter.mockImplementation(() => PDF)
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.includes('/extract-text?filename=')) {
      const name = decodeURIComponent(url.split('filename=')[1])
      const answer = ingestion(name, Buffer.from(init.body as Uint8Array))
      return json(answer.status, answer.body)
    }
    if (url.endsWith('/client-intakes/read')) {
      const answer = rag(JSON.parse(String(init.body)))
      return json(answer.status, answer.body)
    }
    if (url.endsWith('/forms/libreoffice/convert')) {
      const answer = converter()
      return Buffer.isBuffer(answer)
        ? new Response(new Uint8Array(answer))
        : json(answer.status, answer.body)
    }
    throw new Error(`Unexpected call to ${url}`)
  })
})
afterEach(() => {
  s3.clear()
  for (const m of [ingestion, rag, converter]) m.mockReset()
  vi.unstubAllGlobals()
  config.piiProtection = 'off'
})

const field = (value: string | null, documentId = 'x', quote = value) => ({
  value,
  source: value ? { document_id: documentId, quote } : null,
})

// What rag-service answers: one new client, one new site, one first survey.
function proposal(documentId = 'x') {
  return {
    client: {
      name: field('Straits Logistics', documentId),
      division: field(null),
      existing_id: null,
      match_not_sure: false,
    },
    sites: [
      {
        ref: 'site-1',
        existing_id: null,
        match_not_sure: false,
        name: field('Tuas Cold Store', documentId),
        address: field('2 Tuas Road', documentId),
        jurisdiction: field('SG', documentId),
        facility_type: field('Cold store', documentId),
      },
    ],
    assessments: [
      {
        ref: 'a-1',
        site_ref: 'site-1',
        visit_type: field('First survey', documentId),
        site_visit_date: field('2026-12-01', documentId),
        site_visit_end_date: field(null),
        report_due_date: field(null),
        site_contacts: [{ name: 'Mei Tan', role: null, source: null }],
      },
    ],
    documents: [{ id: documentId, placement: { kind: 'client' }, not_sure: false }],
    usage: [],
  }
}

// Uploads files (name -> bytes) and optional pasted text as `as`.
function upload(files: Record<string, Buffer>, pastedText?: string, as = api) {
  const request = as.post('/api/client-intakes')
  for (const [name, bytes] of Object.entries(files)) request.attach('file', bytes, name)
  if (pastedText !== undefined) request.field('pastedText', pastedText)
  return request
}

// The New assessment form as the engineer submits it from an intake.
const FORM = {
  client: { name: 'Straits Logistics' },
  sites: [
    {
      ref: 'site-1',
      name: 'Tuas Cold Store',
      address: '2 Tuas Road',
      jurisdiction: 'SG',
      facilityType: 'Cold store',
      assessments: [
        {
          ref: 'a-1',
          visitType: 'First survey',
          siteVisitDate: '2026-12-01',
          siteContacts: [{ name: 'Mei Tan' }],
        },
      ],
    },
  ],
}

// An intake read and ready, with its files' ids by name.
async function readyIntake(files: Record<string, Buffer> = { 'Request.pdf': PDF }) {
  const uploaded = await upload(files)
  const ids = Object.fromEntries(
    uploaded.body.files.map((f: { name: string; id: string }) => [f.name, f.id]),
  )
  rag.mockImplementation(() => ({ status: 200, body: proposal(Object.values(ids)[0]) }))
  await api.post(`/api/client-intakes/${uploaded.body.id}/read`).expect(200)
  return { id: uploaded.body.id as string, ids }
}

describe('Adding client documents (CP-23 AC1, AC3)', () => {
  it('keeps PDF, Word, Outlook and .eml files by their bytes, and refuses the rest with a reason', async () => {
    const response = await upload(
      {
        'Request.pdf': PDF,
        'Schedule.docx': DOCX,
        'Old form.doc': DOC,
        'Email.msg': MSG,
        'Email.eml': EML,
        'photo.jpg': JPG,
        // A PDF by name only.
        'fake.pdf': JPG,
        'empty.pdf': Buffer.alloc(0),
      },
      'Please also survey Jurong.',
    )

    expect(response.status).toBe(201)
    const byName = Object.fromEntries(response.body.files.map((f: { name: string }) => [f.name, f]))
    for (const name of ['Request.pdf', 'Schedule.docx', 'Old form.doc', 'Email.msg', 'Email.eml'])
      expect(byName[name]).toMatchObject({
        id: expect.any(String),
        status: 'accepted',
        reason: null,
      })
    expect(byName['photo.jpg']).toEqual({
      id: null,
      name: 'photo.jpg',
      size: JPG.length,
      status: 'refused',
      reason: "Can't read .jpg files. Add PDF, Word (.docx, .doc), Outlook (.msg) or .eml files.",
    })
    expect(byName['fake.pdf']).toMatchObject({
      status: 'refused',
      reason: 'File is damaged. Save it again as a PDF and add it.',
    })
    expect(byName['empty.pdf']).toMatchObject({ status: 'refused', reason: 'empty.pdf is empty.' })

    // Only accepted files are stored, each under the intake.
    const intake = await ClientIntakeModel.findById(response.body.id).lean()
    expect(intake).toMatchObject({
      engineer: alex._id,
      status: 'uploaded',
      pastedText: 'Please also survey Jurong.',
      metadata: {
        source_type: 'client_intake',
        jurisdiction: null,
        facility_type: null,
        COPE_dimension: null,
      },
    })
    expect(intake!.files.map((f) => f.ext)).toEqual(['pdf', 'docx', 'doc', 'msg', 'eml'])
    expect([...s3.keys()].sort()).toEqual(intake!.files.map((f) => f.key).sort())
    expect(intake!.files[0].key).toBe(
      `client-intakes/${response.body.id}/${intake!.files[0]._id}.pdf`,
    )
    // Kept for 24 hours.
    const hours = (intake!.expiresAt.getTime() - intake!.createdAt.getTime()) / 3_600_000
    expect(Math.round(hours)).toBe(24)
  })

  it('needs at least one file it keeps, or pasted text', async () => {
    const refused = await upload({ 'photo.jpg': JPG })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe('Add a PDF, Word or email file, or paste the email text.')
    expect(refused.body.files[0].status).toBe('refused')
    expect(await ClientIntakeModel.countDocuments()).toBe(0)

    expect((await upload({}, 'Survey Tuas please.')).status).toBe(201)
  })

  it('is for those who create assessments', async () => {
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await upload({ 'Request.pdf': PDF }, undefined, admin)).status).toBe(403)
  })
})

describe('Reading the documents (CP-23 AC2-AC9, AC18, AC19)', () => {
  it("sends each document's text, the recorded clients and the lists to rag-service, and saves its proposal", async () => {
    // A recorded client with a visited site and a removed one.
    const client = await ClientModel.create({ name: 'Acme', key: 'acme', division: 'Foods' })
    const visited = await SiteModel.create({
      code: 'SITE-0001',
      name: 'Tuas',
      address: '1 Tuas Ave',
      jurisdiction: 'SG',
      facilityType: 'Cold store',
      client: client._id,
    })
    await SiteModel.create({
      code: 'SITE-0002',
      name: 'Gone',
      jurisdiction: 'SG',
      facilityType: 'Office',
      client: client._id,
      removed: { at: new Date(), by: { id: 'x', name: 'x' } },
    })
    await AssessmentModel.create({ reference: 'RPT-1', site: visited._id, surveyType: 'Resurvey' })
    ingestion.mockImplementation((fileName) => ({
      status: 200,
      body: {
        documents: [
          { name: fileName, text: 'Please survey Tuas.' },
          { name: `Attachment: plan.pdf (from ${fileName})`, text: 'Site plan.' },
        ],
      },
    }))
    const uploaded = await upload({ 'Email.eml': EML, 'Old form.doc': DOC }, 'Pasted words.')
    const [eml, doc] = uploaded.body.files.map((f: { id: string }) => f.id)
    rag.mockImplementation(() => ({ status: 200, body: proposal(eml) }))

    const read = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)

    expect(read.status).toBe(200)
    // A .doc is converted to PDF first, and read under a .pdf name.
    expect(converter).toHaveBeenCalledTimes(1)
    expect(ingestion.mock.calls.map(([name]) => name)).toEqual(['Email.eml', 'Old form.pdf'])
    const sent = rag.mock.calls[0][0]
    expect(sent.documents).toEqual([
      { id: eml, name: 'Email.eml', text: 'Please survey Tuas.' },
      { id: `${eml}-1`, name: 'Attachment: plan.pdf (from Email.eml)', text: 'Site plan.' },
      { id: doc, name: 'Old form.doc', text: 'Please survey Tuas.' },
      { id: `${doc}-1`, name: 'Attachment: plan.pdf (from Old form.pdf)', text: 'Site plan.' },
      { id: 'pasted-text', name: 'Pasted text', text: 'Pasted words.' },
    ])
    expect(sent.clients).toEqual([
      {
        id: String(client._id),
        name: 'Acme',
        division: 'Foods',
        sites: [
          { id: String(visited._id), name: 'Tuas', address: '1 Tuas Ave', has_assessments: true },
        ],
      },
    ])
    expect(sent.facility_types).toContain('Cold store')
    expect(sent.jurisdictions).toContainEqual({ code: 'SG', name: 'Singapore' })
    expect(sent.privacy).toEqual({ enabled: false, known_entities: [] })

    expect(read.body).toMatchObject({
      id: uploaded.body.id,
      status: 'ready',
      files: [
        { id: eml, name: 'Email.eml', status: 'read', reason: null },
        { id: doc, name: 'Old form.doc', status: 'read', reason: null },
      ],
      sources: expect.arrayContaining([
        { documentId: `${eml}-1`, name: 'Attachment: plan.pdf (from Email.eml)', fileId: eml },
        { documentId: 'pasted-text', name: 'Pasted text', fileId: null },
      ]),
      result: {
        client: {
          name: { value: 'Straits Logistics', source: { documentId: eml } },
          existingId: null,
        },
        sites: [{ ref: 'site-1', facilityType: { value: 'Cold store' } }],
        assessments: [{ ref: 'a-1', siteRef: 'site-1', visitType: { value: 'First survey' } }],
        documents: [{ fileId: eml, placement: { kind: 'client' }, notSure: false }],
      },
    })
    expect(read.body.result.usage).toBeUndefined()

    // A repeat returns the saved proposal without asking again.
    const again = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)
    expect(again.body.result).toEqual(read.body.result)
    expect(rag).toHaveBeenCalledTimes(1)
  })

  it('masks company and building names too when privacy protection is on (AC18)', async () => {
    config.piiProtection = 'required'
    const { id } = await readyIntake()
    expect(id).toBeTruthy()
    expect(rag.mock.calls[0][0].privacy).toMatchObject({
      enabled: true,
      detect: ['CLIENT', 'SITE'],
    })
  })

  it("marks a file that can't be opened and still reads the others (AC3)", async () => {
    ingestion.mockImplementation((fileName) =>
      fileName === 'Broken.pdf'
        ? { status: 422, body: { detail: 'Broken.pdf is damaged and could not be opened.' } }
        : { status: 200, body: { documents: [{ name: fileName, text: 'Survey Tuas.' }] } },
    )
    const uploaded = await upload({ 'Broken.pdf': PDF, 'Request.pdf': PDF })

    const read = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)

    expect(read.status).toBe(200)
    expect(read.body.files).toMatchObject([
      {
        name: 'Broken.pdf',
        status: 'failed',
        reason: 'File is damaged. Save it again as a PDF and add it.',
      },
      { name: 'Request.pdf', status: 'read', reason: null },
    ])
    expect(rag.mock.calls[0][0].documents).toHaveLength(1)
  })

  it('says how to fix a password-protected PDF (AC4)', async () => {
    ingestion.mockImplementation(() => ({
      status: 422,
      body: { detail: 'This PDF is password-protected and could not be opened.' },
    }))
    const uploaded = await upload({ 'Locked.pdf': PDF, 'Request.pdf': PDF })

    const read = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)

    expect(read.body.files[0]).toMatchObject({
      name: 'Locked.pdf',
      status: 'failed',
      reason: 'Password-protected. Remove the password and add it again.',
    })
  })

  it("lists an email's attachments that couldn't be read as failed files (AC4)", async () => {
    ingestion.mockImplementation((fileName) => ({
      status: 200,
      body: {
        documents: [{ name: fileName, text: 'Please survey Tuas.' }],
        failed: [
          {
            name: `Attachment: old.doc (from ${fileName})`,
            size: 12,
            reason: "Can't read .doc attachments. Save it as .docx or PDF and add it.",
          },
        ],
      },
    }))
    const uploaded = await upload({ 'Email.eml': EML, 'Request.pdf': PDF })

    const read = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)

    expect(read.status).toBe(200)
    // Each after its own email, with no id: it isn't a file that can be kept.
    expect(read.body.files).toEqual([
      expect.objectContaining({ name: 'Email.eml', status: 'read' }),
      {
        id: null,
        name: 'Attachment: old.doc (from Email.eml)',
        size: 12,
        status: 'failed',
        reason: "Can't read .doc attachments. Save it as .docx or PDF and add it.",
      },
      expect.objectContaining({ name: 'Request.pdf', status: 'read' }),
      expect.objectContaining({ name: 'Attachment: old.doc (from Request.pdf)', id: null }),
    ])
    // A repeat read lists them too.
    const again = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)
    expect(again.body.files).toEqual(read.body.files)
  })

  it('says so when no document could be read, and sends nothing to the AI', async () => {
    ingestion.mockImplementation(() => ({ status: 422, body: { detail: 'Encrypted PDF.' } }))
    const uploaded = await upload({ 'Request.pdf': PDF })

    const read = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)

    expect(read.status).toBe(422)
    expect(read.body).toMatchObject({
      error: 'None of the documents could be read.',
      files: [{ status: 'failed', reason: 'Encrypted PDF.' }],
    })
    expect(rag).not.toHaveBeenCalled()
  })

  it('passes on why masking was unavailable, and can be read again (AC19)', async () => {
    rag.mockImplementationOnce(() => ({
      status: 503,
      body: { detail: "Client details couldn't be protected, so nothing was sent to the AI." },
    }))
    const uploaded = await upload({ 'Request.pdf': PDF })

    const read = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)
    expect(read.status).toBe(503)
    expect(read.body).toEqual({
      error: "Client details couldn't be protected, so nothing was sent to the AI.",
    })
    expect((await ClientIntakeModel.findById(uploaded.body.id).lean())!.status).toBe('failed')

    rag.mockImplementationOnce(() => ({ status: 502, body: { detail: 'The AI failed.' } }))
    expect((await api.post(`/api/client-intakes/${uploaded.body.id}/read`)).status).toBe(502)
    expect((await api.post(`/api/client-intakes/${uploaded.body.id}/read`)).status).toBe(200)
  })

  it('answers 404 when the intake was discarded while it was being read', async () => {
    const uploaded = await upload({ 'Request.pdf': PDF })
    // Cancel lands while rag-service is reading.
    const stub = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const answer = await stub(url, init)
      if (url.endsWith('/client-intakes/read'))
        await ClientIntakeModel.deleteOne({ _id: uploaded.body.id })
      return answer
    })

    const read = await api.post(`/api/client-intakes/${uploaded.body.id}/read`)

    expect(read.status).toBe(404)
    expect(await ClientIntakeModel.countDocuments()).toBe(0)
  })

  it('keeps the documents while they are being created from', async () => {
    const uploaded = await upload({ 'Request.pdf': PDF })
    await ClientIntakeModel.updateOne(
      { _id: uploaded.body.id },
      { status: 'creating', updatedAt: new Date() },
    )

    expect((await api.delete(`/api/client-intakes/${uploaded.body.id}`)).status).toBe(409)
    expect(await ClientIntakeModel.countDocuments()).toBe(1)
  })

  it("is only the engineer's own", async () => {
    const uploaded = await upload({ 'Request.pdf': PDF })
    const id = uploaded.body.id
    expect((await jideApi.post(`/api/client-intakes/${id}/read`)).status).toBe(404)
    expect((await jideApi.delete(`/api/client-intakes/${id}`)).status).toBe(404)
    expect((await jideApi.post(`/api/client-intakes/${id}/create`).send(FORM)).status).toBe(404)
    expect((await api.post('/api/client-intakes/not-an-id/read')).status).toBe(404)
  })
})

describe('Discarding an intake (CP-23 AC12)', () => {
  it('deletes the intake and its files', async () => {
    const uploaded = await upload({ 'Request.pdf': PDF, 'Email.eml': EML })

    expect((await api.delete(`/api/client-intakes/${uploaded.body.id}`)).status).toBe(204)
    expect(await ClientIntakeModel.countDocuments()).toBe(0)
    expect(s3.size).toBe(0)
  })

  it('keeps the files when a Create claims the intake just before the discard', async () => {
    const uploaded = await upload({ 'Request.pdf': PDF })
    const stored = (await ClientIntakeModel.findById(uploaded.body.id).lean())!
    // The discard reads it as ready, then Create claims it before the delete.
    await ClientIntakeModel.updateOne({ _id: stored._id }, { status: 'creating' })
    const stale = vi.spyOn(ClientIntakeModel, 'findOne').mockReturnValueOnce({
      lean: async () => ({ ...stored, status: 'ready' }),
    } as never)

    expect((await api.delete(`/api/client-intakes/${uploaded.body.id}`)).status).toBe(409)
    stale.mockRestore()
    expect(await ClientIntakeModel.countDocuments()).toBe(1)
    expect(s3.size).toBe(1)
  })
})

describe('Creating from an intake (CP-23 AC10, AC11)', () => {
  it('creates the records once, keeps each document where it was placed, and drops the intake files', async () => {
    const { id, ids } = await readyIntake({
      'Request.pdf': PDF,
      'Plan.docx': DOCX,
      'Spare.pdf': PDF,
    })
    const body = {
      ...FORM,
      documents: [
        { fileId: ids['Request.pdf'], placement: { kind: 'client' } },
        { fileId: ids['Plan.docx'], placement: { kind: 'site', ref: 'site-1' } },
      ],
    }

    const created = await api.post(`/api/client-intakes/${id}/create`).send(body)

    expect(created.status).toBe(201)
    expect(created.body.assessments).toMatchObject([
      {
        surveyType: 'First survey',
        engineer: { id: String(alex._id) },
        site: { name: 'Tuas Cold Store' },
        siteContacts: [{ name: 'Mei Tan', role: null }],
      },
    ])
    const siteId = created.body.assessments[0].site.id
    const documents = await ClientDocumentModel.find().sort({ name: 1 }).lean()
    expect(documents).toMatchObject([
      {
        name: 'Plan.docx',
        placement: { kind: 'site', site: new Types.ObjectId(siteId) },
        metadata: {
          source_type: 'client_document',
          jurisdiction: 'SG',
          facility_type: 'Cold store',
        },
      },
      {
        name: 'Request.pdf',
        placement: { kind: 'client' },
        uploaded: { by: { id: String(alex._id), name: 'Alex Rowe' } },
        metadata: { jurisdiction: null, facility_type: null, COPE_dimension: null },
      },
    ])
    // Only the kept documents remain in S3, under the client.
    expect([...s3.keys()].sort()).toEqual(documents.map((d) => d.key).sort())
    expect(documents[0].key).toBe(
      `client-documents/${created.body.clientId}/${documents[0]._id}.docx`,
    )
    expect((await ClientIntakeModel.findById(id).lean())!.status).toBe('created')

    // A repeat returns the same records and makes nothing new.
    const again = await api.post(`/api/client-intakes/${id}/create`).send(body)
    expect(again.status).toBe(201)
    expect(again.body.assessments.map((a: { id: string }) => a.id)).toEqual(
      created.body.assessments.map((a: { id: string }) => a.id),
    )
    expect(await AssessmentModel.countDocuments()).toBe(1)
    expect(await ClientDocumentModel.countDocuments()).toBe(2)
    // And it can't be discarded once created.
    expect((await api.delete(`/api/client-intakes/${id}`)).status).toBe(409)
  })

  it('stays created when the intake files cannot be deleted afterwards (review C3)', async () => {
    const { id, ids } = await readyIntake()
    const body = {
      ...FORM,
      documents: [{ fileId: ids['Request.pdf'], placement: { kind: 'client' } }],
    }
    vi.mocked(storage.deleteObject).mockRejectedValue(new Error('S3 down'))
    try {
      const created = await api.post(`/api/client-intakes/${id}/create`).send(body)
      expect(created.status).toBe(201)
    } finally {
      vi.mocked(storage.deleteObject).mockImplementation(async (key: string) => void s3.delete(key))
    }
    const intake = await ClientIntakeModel.findById(id).lean()
    expect(intake!.status).toBe('created')
    expect(intake!.created?.documentIds).toBeTruthy()
    expect(await AssessmentModel.countDocuments()).toBe(1)
  })

  it('removes everything a failed Create made, so a retry starts clean (decision: Check, 4 Nov)', async () => {
    const { id, ids } = await readyIntake()
    const body = {
      ...FORM,
      sites: [
        {
          ...FORM.sites[0],
          assessments: [...FORM.sites[0].assessments, { ref: 'a-2', visitType: 'Follow-up visit' }],
        },
      ],
      documents: [{ fileId: ids['Request.pdf'], placement: { kind: 'assessment', ref: 'a-2' } }],
    }
    // The second assessment fails to save the first time.
    const create = AssessmentModel.create.bind(AssessmentModel)
    let calls = 0
    const failing = vi.spyOn(AssessmentModel, 'create').mockImplementation(((doc: object) => {
      calls++
      if (calls === 2) return Promise.reject(new Error('write failed'))
      return create(doc)
    }) as typeof AssessmentModel.create)

    expect((await api.post(`/api/client-intakes/${id}/create`).send(body)).status).toBe(500)
    failing.mockRestore()
    // Nothing is left: the client, site and first assessment it made are gone.
    expect(await AssessmentModel.countDocuments()).toBe(0)
    expect(await SiteModel.countDocuments()).toBe(0)
    expect(await ClientModel.countDocuments()).toBe(0)
    const intake = (await ClientIntakeModel.findById(id).lean())!
    expect(intake.status).toBe('ready')
    expect(intake.created ?? {}).toEqual({})

    const retried = await api.post(`/api/client-intakes/${id}/create`).send(body)
    expect(retried.status).toBe(201)
    expect(retried.body.assessments.map((a: { surveyType: string }) => a.surveyType)).toEqual([
      'First survey',
      'Follow-up visit',
    ])
    expect(await AssessmentModel.countDocuments()).toBe(2)
    expect(await SiteModel.countDocuments()).toBe(1)
    expect(await ClientModel.countDocuments()).toBe(1)
    const [document] = await ClientDocumentModel.find().lean()
    expect(document.placement).toMatchObject({
      kind: 'assessment',
      assessment: new Types.ObjectId(retried.body.assessments[1].id),
      site: new Types.ObjectId(retried.body.assessments[1].site.id),
    })
  })

  it('makes the records once when Create is sent twice at the same time', async () => {
    const { id, ids } = await readyIntake()
    const body = {
      ...FORM,
      documents: [{ fileId: ids['Request.pdf'], placement: { kind: 'client' } }],
    }

    const answers = await Promise.all(
      [1, 2].map(() => api.post(`/api/client-intakes/${id}/create`).send(body)),
    )

    // One creates; the other is refused while it runs, or returns the same.
    const statuses = answers.map((a) => a.status)
    expect(statuses).toContain(201)
    for (const status of statuses) expect([201, 409]).toContain(status)
    expect(await ClientModel.countDocuments()).toBe(1)
    expect(await SiteModel.countDocuments()).toBe(1)
    expect(await AssessmentModel.countDocuments()).toBe(1)
    expect(await ClientDocumentModel.countDocuments()).toBe(1)
    expect((await ClientIntakeModel.findById(id).lean())!.status).toBe('created')
  })

  it('removes the records and the documents it kept when a document fails to copy', async () => {
    const existing = await ClientModel.create({ name: 'Harbour Foods', key: 'harbour foods' })
    const { id, ids } = await readyIntake({ 'Request.pdf': PDF, 'Plan.docx': DOCX })
    const body = {
      ...FORM,
      client: { id: String(existing._id) },
      documents: [
        { fileId: ids['Request.pdf'], placement: { kind: 'client' } },
        { fileId: ids['Plan.docx'], placement: { kind: 'site', ref: 'site-1' } },
      ],
    }
    // The second document's copy fails.
    const copy = vi.mocked(storage.copyObject)
    copy.mockImplementationOnce(async (from, to) => void s3.set(to, s3.get(from)!))
    copy.mockRejectedValueOnce(new Error('S3 down'))

    expect((await api.post(`/api/client-intakes/${id}/create`).send(body)).status).toBe(500)
    expect(await ClientDocumentModel.countDocuments()).toBe(0)
    expect(await AssessmentModel.countDocuments()).toBe(0)
    expect(await SiteModel.countDocuments()).toBe(0)
    // A client recorded before this Create stays.
    expect(await ClientModel.countDocuments()).toBe(1)
    // Only the intake's own files are left in S3, ready for a retry.
    expect([...s3.keys()].every((key) => key.startsWith(`client-intakes/${id}/`))).toBe(true)
    expect(s3.size).toBe(2)
    expect((await ClientIntakeModel.findById(id).lean())!.status).toBe('ready')

    expect((await api.post(`/api/client-intakes/${id}/create`).send(body)).status).toBe(201)
    expect(await ClientDocumentModel.countDocuments()).toBe(2)
  })

  it('keeps a document added by hand with no tag under the whole client (AC12)', async () => {
    const { id, ids } = await readyIntake()
    const body = { ...FORM, documents: [{ fileId: ids['Request.pdf'] }] }
    expect((await api.post(`/api/client-intakes/${id}/create`).send(body)).status).toBe(201)
    expect(await ClientDocumentModel.findOne().lean()).toMatchObject({
      placement: { kind: 'client' },
    })
  })

  it("refuses a document that isn't the intake's, or placed under an unknown ref", async () => {
    const { id, ids } = await readyIntake()
    const refused = await api.post(`/api/client-intakes/${id}/create`).send({
      ...FORM,
      documents: [
        { fileId: String(new Types.ObjectId()), placement: { kind: 'client' } },
        { fileId: ids['Request.pdf'], placement: { kind: 'site', ref: 'site-9' } },
      ],
    })
    expect(refused.status).toBe(400)
    expect(Object.keys(refused.body.fields)).toEqual([
      'documents.0.fileId',
      'documents.1.placement.ref',
    ])
    expect(await AssessmentModel.countDocuments()).toBe(0)
  })
})

describe("A client's documents (CP-23 AC13, AC14)", () => {
  async function createdWithDocument() {
    const { id, ids } = await readyIntake()
    const created = await api.post(`/api/client-intakes/${id}/create`).send({
      ...FORM,
      documents: [{ fileId: ids['Request.pdf'], placement: { kind: 'assessment', ref: 'a-1' } }],
    })
    return created.body as {
      clientId: string
      assessments: { id: string; reference: string; site: { id: string } }[]
    }
  }

  it('lists each document with where it belongs, and opens the original', async () => {
    const { clientId, assessments } = await createdWithDocument()

    const listed = await api.get(`/api/clients/${clientId}/documents`)
    expect(listed.status).toBe(200)
    expect(listed.body).toEqual([
      {
        id: expect.any(String),
        name: 'Request.pdf',
        contentType: 'application/pdf',
        size: PDF.length,
        placement: {
          kind: 'assessment',
          assessmentId: assessments[0].id,
          reference: assessments[0].reference,
          siteId: assessments[0].site.id,
          siteName: 'Tuas Cold Store',
        },
        uploadedAt: expect.any(String),
        uploadedBy: { id: String(alex._id), name: 'Alex Rowe' },
        origin: 'intake',
        originLabel: 'From client documents',
        tag: `${assessments[0].reference} · Tuas Cold Store`,
      },
    ])

    const file = await api.get(`/api/client-documents/${listed.body[0].id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('application/pdf')
    expect(file.headers['content-disposition']).toBe(
      `inline; filename="Request.pdf"; filename*=UTF-8''Request.pdf`,
    )
    const download = await api.get(`/api/client-documents/${listed.body[0].id}/file?download=1`)
    expect(download.headers['content-disposition']).toBe(
      `attachment; filename="Request.pdf"; filename*=UTF-8''Request.pdf`,
    )
    expect(Buffer.from(file.body)).toEqual(PDF)

    expect((await api.get(`/api/clients/${new Types.ObjectId()}/documents`)).status).toBe(404)
    expect((await api.get(`/api/client-documents/${new Types.ObjectId()}/file`)).status).toBe(404)
  })

  it('is refused to an engineer with no assessment at the client, as the client page is', async () => {
    const { clientId } = await createdWithDocument()
    const [listed] = (await api.get(`/api/clients/${clientId}/documents`)).body

    expect((await jideApi.get(`/api/clients/${clientId}/documents`)).status).toBe(403)
    expect((await jideApi.get(`/api/client-documents/${listed.id}/file`)).status).toBe(403)
    expect((await jideApi.delete(`/api/client-documents/${listed.id}`)).status).toBe(403)
    expect(await ClientDocumentModel.countDocuments()).toBe(1)
    // A knowledge admin sees every assessment, so may read them.
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get(`/api/clients/${clientId}/documents`)).status).toBe(200)
    expect((await admin.get(`/api/client-documents/${listed.id}/file`)).status).toBe(200)
  })

  it('uploads documents to an existing client, whole client unless tagged, refusing the rest (AC15)', async () => {
    const { clientId, assessments } = await createdWithDocument()
    const siteId = assessments[0].site.id
    const send = (placement?: object, as = api) => {
      const request = as.post(`/api/clients/${clientId}/documents`)
      request.attach('file', PDF, 'Lease.pdf').attach('file', JPG, 'photo.jpg')
      if (placement) request.field('placement', JSON.stringify(placement))
      return request
    }

    const plain = await send()
    expect(plain.status).toBe(201)
    expect(plain.body.files).toMatchObject([
      {
        name: 'Lease.pdf',
        status: 'kept',
        document: {
          placement: { kind: 'client' },
          origin: 'upload',
          originLabel: 'Uploaded by Alex Rowe',
          tag: 'Whole client',
        },
      },
      {
        name: 'photo.jpg',
        status: 'refused',
        reason: expect.stringMatching(/^Can't read \.jpg files\./),
      },
    ])
    const stored = await ClientDocumentModel.findOne({ name: 'Lease.pdf' }).lean()
    expect(stored!.key).toBe(`client-documents/${clientId}/${stored!._id}.pdf`)
    expect(s3.get(stored!.key)).toEqual(PDF)
    expect(stored!.metadata).toMatchObject({ jurisdiction: null, facility_type: null })

    const tagged = await send({ kind: 'site', siteId })
    expect(tagged.body.files[0].document).toMatchObject({
      placement: { kind: 'site', siteId, siteName: 'Tuas Cold Store' },
      tag: 'Tuas Cold Store',
    })
    expect(
      (await ClientDocumentModel.findById(tagged.body.files[0].document.id).lean())!.metadata,
    ).toMatchObject({ jurisdiction: 'SG', facility_type: 'Cold store' })

    // A site that isn't this client's, nothing kept, and a stranger.
    expect((await send({ kind: 'site', siteId: String(new Types.ObjectId()) })).status).toBe(400)
    expect((await send(undefined, jideApi)).status).toBe(403)
    const none = await api
      .post(`/api/clients/${clientId}/documents`)
      .attach('file', JPG, 'photo.jpg')
    expect(none.status).toBe(400)
    expect(none.body.files[0].status).toBe('refused')
    expect(await ClientDocumentModel.countDocuments()).toBe(3)
  })

  it("still keeps the other files when one can't be saved, and says so for that one", async () => {
    const { clientId } = await createdWithDocument()
    // The second file's S3 upload fails.
    const put = vi.mocked(storage.putObject)
    put.mockImplementationOnce(async (key, body) => void s3.set(key, body as Buffer))
    put.mockRejectedValueOnce(new Error('S3 down'))

    const sent = await api
      .post(`/api/clients/${clientId}/documents`)
      .attach('file', PDF, 'A.pdf')
      .attach('file', PDF, 'B.pdf')
      .attach('file', PDF, 'C.pdf')

    expect(sent.status).toBe(201)
    expect(sent.body.files).toMatchObject([
      { name: 'A.pdf', status: 'kept' },
      { name: 'B.pdf', status: 'refused', reason: "Couldn't save it. Try again." },
      { name: 'C.pdf', status: 'kept' },
    ])
    expect(await ClientDocumentModel.countDocuments({ origin: 'upload' })).toBe(2)
  })

  it('keeps a saved upload and its file when listing it afterwards fails', async () => {
    const { clientId } = await createdWithDocument()
    // Naming the saved document's tag fails (the second find: the first checks access).
    const find = AssessmentModel.find.bind(AssessmentModel)
    let calls = 0
    const lookup = vi.spyOn(AssessmentModel, 'find').mockImplementation(((...args: unknown[]) => {
      if (++calls === 2) throw new Error('db down')
      return (find as (...a: unknown[]) => unknown)(...args)
    }) as never)

    const sent = await api.post(`/api/clients/${clientId}/documents`).attach('file', PDF, 'A.pdf')
    lookup.mockRestore()

    expect(sent.status).toBe(500)
    const saved = await ClientDocumentModel.findOne({ name: 'A.pdf' }).lean()
    expect(s3.get(saved!.key)).toEqual(PDF)
  })

  it("changes a document's tag, updating its site details (decision 4)", async () => {
    const { clientId, assessments } = await createdWithDocument()
    const [doc] = (await api.get(`/api/clients/${clientId}/documents`)).body
    const siteId = assessments[0].site.id

    const site = await api.patch(`/api/client-documents/${doc.id}`).send({
      placement: { kind: 'site', siteId },
    })
    expect(site.status).toBe(200)
    expect(site.body.placement).toMatchObject({ kind: 'site', siteId })
    expect((await ClientDocumentModel.findById(doc.id).lean())!.metadata).toMatchObject({
      jurisdiction: 'SG',
      facility_type: 'Cold store',
    })

    const whole = await api
      .patch(`/api/client-documents/${doc.id}`)
      .send({ placement: { kind: 'client' } })
    expect(whole.body.tag).toBe('Whole client')
    expect((await ClientDocumentModel.findById(doc.id).lean())!.metadata).toMatchObject({
      jurisdiction: null,
      facility_type: null,
    })

    const other = await SiteModel.create({
      code: 'OTHER-1',
      name: 'Other',
      jurisdiction: 'SG',
      facilityType: 'Cold store',
    })
    const refused = (placement: object) =>
      api.patch(`/api/client-documents/${doc.id}`).send({ placement })
    expect((await refused({ kind: 'site', siteId: String(other._id) })).status).toBe(400)
    expect(
      (await refused({ kind: 'assessment', assessmentId: String(new Types.ObjectId()) })).status,
    ).toBe(400)
    expect((await refused({ kind: 'nonsense' })).status).toBe(400)
    expect(
      (
        await jideApi
          .patch(`/api/client-documents/${doc.id}`)
          .send({ placement: { kind: 'client' } })
      ).status,
    ).toBe(403)
  })

  it("lists the client's tag options: whole client, its sites and its assessments", async () => {
    const { clientId, assessments } = await createdWithDocument()
    const options = await api.get(`/api/clients/${clientId}/document-tags`)
    expect(options.status).toBe(200)
    expect(options.body).toEqual([
      { placement: { kind: 'client' }, label: 'Whole client' },
      { placement: { kind: 'site', siteId: assessments[0].site.id }, label: 'Tuas Cold Store' },
      {
        placement: { kind: 'assessment', assessmentId: assessments[0].id },
        label: `${assessments[0].reference} · Tuas Cold Store`,
      },
    ])
  })

  it('offers and accepts only the sites and assessments the client page shows the engineer', async () => {
    const { clientId } = await createdWithDocument()
    const [doc] = (await api.get(`/api/clients/${clientId}/documents`)).body
    // Jide's site at the same client, and a site of Alex's that was removed.
    const theirs = await jideApi.post('/api/assessments').send({
      client: { id: clientId },
      sites: [
        {
          ref: 's',
          name: 'Jurong Hub',
          address: '9 Jurong Road',
          jurisdiction: 'SG',
          facilityType: 'Cold store',
          assessments: [{ ref: 'a', visitType: 'First survey' }],
        },
      ],
    })
    expect(theirs.status).toBe(201)
    const [jides] = theirs.body.assessments
    const removed = await SiteModel.create({
      code: 'SITE-0099',
      name: 'Old Depot',
      jurisdiction: 'SG',
      facilityType: 'Cold store',
      client: clientId,
      removed: { at: new Date(), by: { id: String(alex._id), name: 'Alex Rowe' } },
    })
    const old = await AssessmentModel.create({
      reference: 'RPT-OLD',
      site: removed._id,
      surveyType: 'First survey',
      engineer: alex._id,
    })

    const labels = (await api.get(`/api/clients/${clientId}/document-tags`)).body.map(
      (o: { label: string }) => o.label,
    )
    expect(labels).toHaveLength(3)
    expect(labels.join()).not.toMatch(/Jurong|Old Depot/)
    const retag = (placement: object) =>
      api.patch(`/api/client-documents/${doc.id}`).send({ placement })
    expect((await retag({ kind: 'site', siteId: jides.site.id })).status).toBe(400)
    expect((await retag({ kind: 'assessment', assessmentId: jides.id })).status).toBe(400)
    expect((await retag({ kind: 'site', siteId: String(removed._id) })).status).toBe(400)
    expect((await retag({ kind: 'assessment', assessmentId: String(old._id) })).status).toBe(400)
    // A knowledge admin sees every engineer's work, so may use Jide's site.
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get(`/api/clients/${clientId}/document-tags`)).body).toHaveLength(5)
  })

  it('deletes a document and its file', async () => {
    const { clientId } = await createdWithDocument()
    const [listed] = (await api.get(`/api/clients/${clientId}/documents`)).body

    expect((await api.delete(`/api/client-documents/${listed.id}`)).status).toBe(204)
    expect(await ClientDocumentModel.countDocuments()).toBe(0)
    expect(s3.size).toBe(0)
    expect((await api.delete(`/api/client-documents/${listed.id}`)).status).toBe(404)
  })

  it("keeps the document and says so when its file can't be deleted", async () => {
    const { clientId } = await createdWithDocument()
    const [listed] = (await api.get(`/api/clients/${clientId}/documents`)).body
    vi.mocked(storage.deleteObject).mockRejectedValueOnce(new Error('S3 down'))

    const refused = await api.delete(`/api/client-documents/${listed.id}`)
    expect(refused.status).toBe(502)
    expect(refused.body).toEqual({ error: "Couldn't delete the file. Try again." })
    expect(await ClientDocumentModel.countDocuments()).toBe(1)
    expect(s3.size).toBe(1)

    // Tried again, it goes; a file already missing in S3 deletes fine too.
    expect((await api.delete(`/api/client-documents/${listed.id}`)).status).toBe(204)
    expect(await ClientDocumentModel.countDocuments()).toBe(0)
  })
})

describe('The daily cleanup (CP-23 AC12)', () => {
  it('deletes intakes past their 24 hours with their files, and keeps the rest', async () => {
    const old = await upload({ 'Request.pdf': PDF })
    const fresh = await upload({ 'Email.eml': EML })

    const tomorrow = new Date(Date.now() + 24 * 3_600_000 + 60_000)
    await ClientIntakeModel.updateOne(
      { _id: fresh.body.id },
      { expiresAt: new Date(tomorrow.getTime() + 1) },
    )
    expect(await cleanupExpiredIntakes(tomorrow)).toBe(1)

    expect((await ClientIntakeModel.find().lean()).map((i) => String(i._id))).toEqual([
      fresh.body.id,
    ])
    expect([...s3.keys()].every((key) => key.startsWith(`client-intakes/${fresh.body.id}/`))).toBe(
      true,
    )
    expect(old.status).toBe(201)
  })

  it('keeps an expired intake that is being read or created (its files are in use)', async () => {
    const reading = await upload({ 'Request.pdf': PDF })
    const creating = await upload({ 'Email.eml': EML })
    await ClientIntakeModel.updateOne({ _id: reading.body.id }, { status: 'reading' })
    await ClientIntakeModel.updateOne({ _id: creating.body.id }, { status: 'creating' })

    const later = new Date(Date.now() + 25 * 3_600_000)
    expect(await cleanupExpiredIntakes(later)).toBe(0)
    expect(await ClientIntakeModel.countDocuments()).toBe(2)
  })
})

describe('Documents tagged to another engineer (CP-23 review C1)', () => {
  it('hides a site- or assessment-tagged document from an engineer who has no part in it', async () => {
    const client = await ClientModel.create({ name: 'Shared Client', key: 'shared client' })
    const site = (code: string) =>
      SiteModel.create({
        code,
        name: code,
        jurisdiction: 'SG',
        facilityType: 'Office',
        client: client._id,
      })
    const [alexSite, jideSite] = [await site('ALEX-S'), await site('JIDE-S')]
    const visit = (reference: string, siteId: Types.ObjectId, who: typeof alex) =>
      AssessmentModel.create({
        reference,
        site: siteId,
        surveyType: 'First survey',
        siteVisitDate: new Date(),
        engineer: who._id,
      })
    const alexVisit = await visit('RPT-2026-9001', alexSite._id, alex)
    await visit('RPT-2026-9002', jideSite._id, jide)
    const doc = (name: string, placement: object) =>
      ClientDocumentModel.create({
        client: client._id,
        placement,
        name,
        contentType: 'application/pdf',
        size: PDF.length,
        sha256: name,
        key: `client-documents/${client._id}/${name}`,
        origin: 'upload',
        uploaded: { at: new Date(), by: { id: String(alex._id), name: 'Alex Rowe' } },
        metadata: {
          source_type: 'client_document',
          jurisdiction: null,
          facility_type: null,
          COPE_dimension: null,
          effective_date: new Date(),
        },
      })
    await doc('whole.pdf', { kind: 'client' })
    const onSite = await doc('site.pdf', { kind: 'site', site: alexSite._id })
    const onVisit = await doc('visit.pdf', {
      kind: 'assessment',
      site: alexSite._id,
      assessment: alexVisit._id,
    })
    for (const d of [onSite, onVisit]) s3.set(d.key, PDF)

    const names = async (as: typeof api) =>
      ((await as.get(`/api/clients/${client._id}/documents`)).body as { name: string }[])
        .map((d) => d.name)
        .sort()
    expect(await names(api)).toEqual(['site.pdf', 'visit.pdf', 'whole.pdf'])
    expect(await names(jideApi)).toEqual(['whole.pdf'])

    for (const d of [onSite, onVisit]) {
      expect((await jideApi.get(`/api/client-documents/${d._id}/file`)).status).toBe(404)
      const retag = await jideApi
        .patch(`/api/client-documents/${d._id}`)
        .send({ placement: { kind: 'client' } })
      expect(retag.status).toBe(404)
      expect((await jideApi.delete(`/api/client-documents/${d._id}`)).status).toBe(404)
    }
    expect(await ClientDocumentModel.countDocuments()).toBe(3)

    // A knowledge admin sees every assessment, so every document.
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get(`/api/client-documents/${onVisit._id}/file`)).status).toBe(200)
  })
})
