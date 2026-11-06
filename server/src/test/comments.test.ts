import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { ReportCommentThreadModel } from '../models/report-comment.model'
import { ReportSectionVersionModel } from '../models/report-section-version.model'
import { SiteModel } from '../models/site.model'
import { UserModel, type UserRole } from '../models/user.model'
import { openThreadCount } from '../services/comment.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs } from './auth-test-helpers'

// Comment threads on the report (RV-03): starting one on a passage, replies,
// editing and deleting one's own comments, resolving and
// reopening, and moving a thread as the document editor saves its text.

useMemoryMongo()

const person = (name: string, staffId: string, role: UserRole = 'risk_engineer') => ({
  _id: new Types.ObjectId(),
  staffId,
  name,
  email: `${staffId}@example.com`,
  role,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const engineer = person('Alex Rowe', 'TEST-1')
const admin = person('Sana Patel', 'TEST-2', 'knowledge_admin')
// A risk engineer the assessment is not assigned to: they cannot open it.
const colleague = person('Jide Okafor', 'TEST-3')
const asEngineer = signedInAs(app, engineer)
const asAdmin = signedInAs(app, admin)
const asColleague = signedInAs(app, colleague)

const REFERENCE = 'RPT-2026-0411'
const base = `/api/assessments/${REFERENCE}/comments`

const TEXT = 'Riser penetrations were not fire-stopped at Level 3.'
// A thread on "not fire-stopped" in Section 7's first paragraph.
const ANCHOR = {
  sectionId: '7',
  start: 24,
  end: 40,
  exact: 'not fire-stopped',
  prefix: 'Riser penetrations were ',
  suffix: ' at Level 3.',
}

async function assessment(archived = false) {
  await UserModel.create([engineer, admin, colleague])
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tilbury Distribution Centre',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  return await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'First survey',
    engineer: engineer._id,
    locations: [],
    ...(archived && { archivedAt: new Date() }),
  })
}

type Thread = {
  id: string
  anchor: typeof ANCHOR
  detached: boolean
  status: 'open' | 'resolved'
  resolved: { by: { id: string; name: string }; at: string } | null
  comments: {
    id: string
    body: string
    by: { id: string; name: string }
    at: string
    editedAt: string | null
    deleted: boolean
  }[]
}

const start = async (body = 'Is this still the case after the works?') => {
  const response = await asEngineer.post(base).send({ anchor: ANCHOR, body })
  expect(response.status).toBe(201)
  return response.body.thread as Thread
}

describe('starting a thread (AC1)', () => {
  it('anchors a thread to the passage, with its first comment by its author', async () => {
    await assessment()
    const thread = await start()
    expect(thread.anchor).toEqual(ANCHOR)
    expect(thread.status).toBe('open')
    expect(thread.detached).toBe(false)
    expect(thread.comments).toHaveLength(1)
    expect(thread.comments[0]).toMatchObject({
      body: 'Is this still the case after the works?',
      by: { id: String(engineer._id), name: 'Alex Rowe' },
      editedAt: null,
      deleted: false,
    })

    const listed = await asEngineer.get(base)
    expect(listed.status).toBe(200)
    expect(listed.body.threads.map((t: Thread) => t.id)).toEqual([thread.id])
  })

  it('never adds a version of the text: comments are kept apart from it', async () => {
    await assessment()
    await start()
    expect(await ReportSectionVersionModel.countDocuments()).toBe(0)
    const stored = await ReportCommentThreadModel.findOne().lean()
    expect(stored?.metadata).toMatchObject({
      source_type: 'report_comment_thread',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'all',
    })
  })

  it('refuses a quote that is not the text between its offsets, or an empty comment', async () => {
    await assessment()
    const wrong = await asEngineer.post(base).send({ anchor: { ...ANCHOR, end: 30 }, body: 'Hm.' })
    expect(wrong.status).toBe(400)
    expect(wrong.body.fields['anchor.exact']).toMatch(/does not match/)

    const empty = await asEngineer.post(base).send({ anchor: ANCHOR, body: '   ' })
    expect(empty.status).toBe(400)
    expect(empty.body.fields.body).toBe('Write a comment.')
    expect(await ReportCommentThreadModel.countDocuments()).toBe(0)
  })

  it('404s for an unknown assessment', async () => {
    await assessment()
    const response = await asEngineer
      .post('/api/assessments/RPT-2026-9999/comments')
      .send({ anchor: ANCHOR, body: 'Hm.' })
    expect(response.status).toBe(404)
  })
})

describe('replies (AC2)', () => {
  it('adds each reply under the thread with its author and time, oldest first', async () => {
    await assessment()
    const thread = await start()
    const first = await asAdmin
      .post(`${base}/${thread.id}/replies`)
      .send({ body: 'Checked on the photos: yes.' })
    expect(first.status).toBe(201)
    await asEngineer.post(`${base}/${thread.id}/replies`).send({ body: 'Thanks, noted.' })

    const [listed] = (await asEngineer.get(base)).body.threads as Thread[]
    expect(listed.comments.map((c) => [c.by.name, c.body])).toEqual([
      ['Alex Rowe', 'Is this still the case after the works?'],
      ['Sana Patel', 'Checked on the photos: yes.'],
      ['Alex Rowe', 'Thanks, noted.'],
    ])
    const times = listed.comments.map((c) => new Date(c.at).getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('404s for a thread that is not on this assessment', async () => {
    await assessment()
    const response = await asEngineer
      .post(`${base}/${new Types.ObjectId()}/replies`)
      .send({ body: 'Hello?' })
    expect(response.status).toBe(404)
  })
})

describe("editing and deleting one's own comments (AC3)", () => {
  it('marks an edited comment as edited', async () => {
    await assessment()
    const thread = await start()
    const comment = thread.comments[0]
    const edited = await asEngineer
      .patch(`${base}/${thread.id}/comments/${comment.id}`)
      .send({ body: 'Is this still so after the March works?' })
    expect(edited.status).toBe(200)
    expect(edited.body.thread.comments[0].body).toBe('Is this still so after the March works?')
    expect(edited.body.thread.comments[0].editedAt).not.toBeNull()
  })

  it("refuses to edit or delete someone else's comment", async () => {
    await assessment()
    const thread = await start()
    const comment = thread.comments[0]
    const edit = await asAdmin
      .patch(`${base}/${thread.id}/comments/${comment.id}`)
      .send({ body: 'Changed by someone else' })
    expect(edit.status).toBe(403)
    expect(edit.body.error).toBe('Only its author can change or delete a comment.')
    expect((await asAdmin.delete(`${base}/${thread.id}/comments/${comment.id}`)).status).toBe(403)

    const [listed] = (await asEngineer.get(base)).body.threads as Thread[]
    expect(listed.comments[0].body).toBe('Is this still the case after the works?')
  })

  it('removes a deleted reply, and the thread with its last comment', async () => {
    await assessment()
    const thread = await start()
    const reply = (
      await asAdmin.post(`${base}/${thread.id}/replies`).send({ body: 'Yes, still open.' })
    ).body.thread.comments[1]

    const afterReply = await asAdmin.delete(`${base}/${thread.id}/comments/${reply.id}`)
    expect(afterReply.status).toBe(200)
    expect(afterReply.body.thread.comments).toHaveLength(1)

    const afterLast = await asEngineer.delete(
      `${base}/${thread.id}/comments/${thread.comments[0].id}`,
    )
    expect(afterLast.status).toBe(200)
    expect(afterLast.body.thread).toBeNull()
    expect(await ReportCommentThreadModel.countDocuments()).toBe(0)
  })

  it('keeps the replies when the first comment is deleted, which then reads as deleted', async () => {
    await assessment()
    const thread = await start()
    await asAdmin.post(`${base}/${thread.id}/replies`).send({ body: 'Yes, still open.' })
    const response = await asEngineer.delete(
      `${base}/${thread.id}/comments/${thread.comments[0].id}`,
    )
    expect(response.status).toBe(200)
    const comments = (response.body.thread as Thread).comments
    expect(comments.map((c) => [c.deleted, c.body])).toEqual([
      [true, ''],
      [false, 'Yes, still open.'],
    ])
  })
})

describe('resolving and reopening (AC5)', () => {
  it('resolves a thread, naming who did, and reopens it', async () => {
    await assessment()
    const thread = await start()
    const resolved = await asAdmin.post(`${base}/${thread.id}/resolve`)
    expect(resolved.status).toBe(200)
    expect(resolved.body.thread.status).toBe('resolved')
    expect(resolved.body.thread.resolved.by).toEqual({ id: String(admin._id), name: 'Sana Patel' })

    const reopened = await asEngineer.post(`${base}/${thread.id}/reopen`)
    expect(reopened.body.thread.status).toBe('open')
    expect(reopened.body.thread.resolved).toBeNull()
  })
})

describe('moving threads with the text (AC6)', () => {
  it('moves a thread to what remains of its text, and detaches one whose text is deleted', async () => {
    await assessment()
    const kept = await start()
    const lost = await start('And this?')
    // "not fire-stopped" edited to "not stopped".
    const moved = { ...ANCHOR, end: 35, exact: 'not stopped' }
    const response = await asEngineer.put(`${base}/anchors`).send({
      anchors: [
        { id: kept.id, anchor: moved },
        { id: lost.id, anchor: null },
      ],
    })
    expect(response.status).toBe(200)
    expect(response.body.updated).toBe(2)

    const threads = (await asEngineer.get(base)).body.threads as Thread[]
    expect(threads[0]).toMatchObject({ anchor: moved, detached: false })
    // Detached, it still quotes the text it was on.
    expect(threads[1]).toMatchObject({ anchor: ANCHOR, detached: true })
  })

  it('only lets the engineer who saves the text move threads', async () => {
    await assessment()
    const thread = await start()
    const response = await asAdmin
      .put(`${base}/anchors`)
      .send({ anchors: [{ id: thread.id, anchor: null }] })
    expect(response.status).toBe(403)
    expect((await ReportCommentThreadModel.findOne().lean())?.detached).toBe(false)
  })
})

describe('who can comment (AC7)', () => {
  it('lets a knowledge admin start threads and reply, but not change the text', async () => {
    await assessment()
    const started = await asAdmin.post(base).send({ anchor: ANCHOR, body: 'Source?' })
    expect(started.status).toBe(201)
    const reply = await asAdmin
      .post(`${base}/${started.body.thread.id}/replies`)
      .send({ body: 'Never mind, found it.' })
    expect(reply.status).toBe(201)

    const save = await asAdmin.put(`/api/assessments/${REFERENCE}/sections/1/document`).send({
      baseVersion: 0,
      draftId: null,
      document: {
        intro: [{ type: 'paragraph', content: [{ type: 'text', text: TEXT }] }],
        subsections: [],
      },
    })
    expect(save.status).toBe(403)
  })

  it('refuses a risk engineer who cannot open the assessment', async () => {
    await assessment()
    await start()
    expect((await asColleague.get(base)).status).toBe(403)
    const response = await asColleague.post(base).send({ anchor: ANCHOR, body: 'Hm.' })
    expect(response.status).toBe(403)
    expect(response.body.error).toMatch(/assigned engineer and knowledge admins/)
  })

  it('reads the threads of an archived assessment, but takes no new ones', async () => {
    await assessment(true)
    expect((await asEngineer.get(base)).status).toBe(200)
    const response = await asEngineer.post(base).send({ anchor: ANCHOR, body: 'Hm.' })
    expect(response.status).toBe(409)
  })
})

describe('the export reminder (AC9)', () => {
  it('counts the threads still open', async () => {
    await assessment()
    const one = await start()
    await start('Second')
    await asEngineer.post(`${base}/${one.id}/resolve`)
    expect(await openThreadCount(REFERENCE)).toBe(1)
  })
})
