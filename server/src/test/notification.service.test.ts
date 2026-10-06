import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { NotificationModel } from '../models/notification.model'
import type { UserRole } from '../models/user.model'
import type { SessionUser } from '../services/auth.service'
import {
  countsForUser,
  createNotification,
  dismissAllForUser,
  listForUser,
  markAllReadForUser,
  markAsRead,
  NotificationNotFoundError,
} from '../services/notification.service'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const ADMIN_ID = '6ab39017e45cf009e4507731'
const OTHER_ADMIN_ID = '6ab39017e45cf009e4507732'
const ENGINEER_ID = '6ab39017e45cf009e4507733'

function session(id: string, role: UserRole, name = 'Test User'): SessionUser {
  return { id, role, name }
}

const admin = session(ADMIN_ID, 'knowledge_admin', 'Sana Patel')
const otherAdmin = session(OTHER_ADMIN_ID, 'knowledge_admin', 'Mei Tan')
const engineer = session(ENGINEER_ID, 'risk_engineer', 'Jide Okafor')

// An ingestion notification for every knowledge admin. Tests override the
// audience and role as needed.
const forAllAdmins = (message = 'FM Global 2-0 failed during chunking.') => ({
  purpose: 'ingestion_status' as const,
  message,
  targetRole: 'knowledge_admin' as const,
  targetUserIds: ['all'],
})

// Creates `count` notifications in order, so the newest is the last made.
async function seedSeries(count: number) {
  for (let n = 1; n <= count; n++) {
    await createNotification(forAllAdmins(`Document ${n} finished ingesting.`))
  }
}

const messagesOf = (items: { message: string }[]) => items.map((i) => i.message)

describe('createNotification', () => {
  it('returns the stored notification, unread, as a DTO', async () => {
    const created = await createNotification({
      ...forAllAdmins(),
      details: 'No text could be read from this PDF.',
      context: { documentId: ADMIN_ID, stage: 'chunking' },
      createdByService: 'ingestion-service',
    })

    expect(created.id).toMatch(/^[a-f0-9]{24}$/)
    expect(created.purpose).toBe('ingestion_status')
    expect(created.message).toBe('FM Global 2-0 failed during chunking.')
    expect(created.details).toBe('No text could be read from this PDF.')
    expect(created.context).toEqual({ documentId: ADMIN_ID, stage: 'chunking' })
    expect(created.read).toBe(false)
    expect(created.createdAt).toBeInstanceOf(Date)
  })

  it('reports an absent details and context as null, not undefined', async () => {
    const created = await createNotification(forAllAdmins())
    expect(created.details).toBeNull()
    expect(created.context).toBeNull()
  })

  // readBy and dismissedBy hold other users' ids; the DTO must not carry them.
  it('never exposes who else has read or dismissed it', async () => {
    const created = await createNotification(forAllAdmins())
    expect(created).not.toHaveProperty('readBy')
    expect(created).not.toHaveProperty('dismissedBy')
    expect(created).not.toHaveProperty('targetUserIds')
  })
})

describe('listForUser audience', () => {
  it('shows a role-wide notification to that role', async () => {
    await createNotification(forAllAdmins())

    const { items, total } = await listForUser(admin, 10, 0)

    expect(messagesOf(items)).toEqual(['FM Global 2-0 failed during chunking.'])
    expect(total).toBe(1)
  })

  it('hides a role-wide notification from the other role', async () => {
    await createNotification(forAllAdmins())

    const { items, total } = await listForUser(engineer, 10, 0)

    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  // The role comes from the session on every request, and is never copied onto
  // the notification's recipients, so moving a user between roles takes effect
  // at once rather than needing existing notifications rewritten.
  it('stops showing admin notifications to a user whose role changed', async () => {
    await createNotification({ ...forAllAdmins(), targetUserIds: [ADMIN_ID] })
    expect((await listForUser(admin, 10, 0)).items).toHaveLength(1)

    const movedToEngineer = session(ADMIN_ID, 'risk_engineer', 'Sana Patel')

    expect((await listForUser(movedToEngineer, 10, 0)).items).toEqual([])
    expect(await countsForUser(movedToEngineer)).toEqual({ total: 0, unread: 0 })
  })

  it('shows a user-targeted notification only to those users', async () => {
    await createNotification({ ...forAllAdmins(), targetUserIds: [OTHER_ADMIN_ID] })

    expect((await listForUser(otherAdmin, 10, 0)).items).toHaveLength(1)
    expect((await listForUser(admin, 10, 0)).items).toEqual([])
  })

  it('shows everyone in the role when "all" leads the audience, whatever follows', async () => {
    await createNotification({ ...forAllAdmins(), targetUserIds: ['all', OTHER_ADMIN_ID] })

    expect((await listForUser(admin, 10, 0)).items).toHaveLength(1)
    expect((await listForUser(otherAdmin, 10, 0)).items).toHaveLength(1)
  })

  // The sentinel is positional: "all" anywhere but first is just an id that
  // matches nobody, so the named users are the audience.
  it('treats "all" after the first position as a plain id', async () => {
    await createNotification({ ...forAllAdmins(), targetUserIds: [OTHER_ADMIN_ID, 'all'] })

    expect((await listForUser(otherAdmin, 10, 0)).items).toHaveLength(1)
    expect((await listForUser(admin, 10, 0)).items).toEqual([])
  })
})

describe('listForUser paging', () => {
  it('returns the newest first', async () => {
    await seedSeries(3)

    const { items } = await listForUser(admin, 10, 0)

    expect(messagesOf(items)).toEqual([
      'Document 3 finished ingesting.',
      'Document 2 finished ingesting.',
      'Document 1 finished ingesting.',
    ])
  })

  it('pages through every notification without a gap or a repeat', async () => {
    await seedSeries(5)

    const first = await listForUser(admin, 2, 0)
    const second = await listForUser(admin, 2, 2)
    const third = await listForUser(admin, 2, 4)

    expect(messagesOf(first.items)).toEqual([
      'Document 5 finished ingesting.',
      'Document 4 finished ingesting.',
    ])
    expect(messagesOf(second.items)).toEqual([
      'Document 3 finished ingesting.',
      'Document 2 finished ingesting.',
    ])
    expect(messagesOf(third.items)).toEqual(['Document 1 finished ingesting.'])
  })

  it('reports the total across every page, not the page size', async () => {
    await seedSeries(5)

    const { items, total } = await listForUser(admin, 2, 0)

    expect(items).toHaveLength(2)
    expect(total).toBe(5)
  })

  it('counts only what the caller can see in the total', async () => {
    await seedSeries(3)
    await createNotification({
      ...forAllAdmins('A draft needs review.'),
      targetRole: 'risk_engineer',
    })

    expect((await listForUser(admin, 10, 0)).total).toBe(3)
    expect((await listForUser(engineer, 10, 0)).total).toBe(1)
  })

  it('returns an empty page past the end', async () => {
    await seedSeries(2)

    const { items, total } = await listForUser(admin, 2, 10)

    expect(items).toEqual([])
    expect(total).toBe(2)
  })
})

describe('markAsRead', () => {
  it('marks it read for the caller only', async () => {
    const created = await createNotification(forAllAdmins())

    await markAsRead(created.id, admin)

    const mine = await listForUser(admin, 10, 0)
    expect(mine.items[0].read).toBe(true)
    expect(mine.unread).toBe(0)

    const theirs = await listForUser(otherAdmin, 10, 0)
    expect(theirs.items[0].read).toBe(false)
    expect(theirs.unread).toBe(1)
  })

  it('leaves the notification in the list once read', async () => {
    const created = await createNotification(forAllAdmins())

    await markAsRead(created.id, admin)

    const { items, total } = await listForUser(admin, 10, 0)
    expect(items).toHaveLength(1)
    expect(total).toBe(1)
  })

  it('is unchanged by marking it read twice', async () => {
    const created = await createNotification(forAllAdmins())

    await markAsRead(created.id, admin)
    await markAsRead(created.id, admin)

    expect((await listForUser(admin, 10, 0)).unread).toBe(0)
    const stored = await NotificationModel.findById(created.id).lean()
    expect(stored!.readBy).toEqual([ADMIN_ID])
  })

  it('refuses a notification the caller cannot see', async () => {
    const created = await createNotification(forAllAdmins())

    await expect(markAsRead(created.id, engineer)).rejects.toThrow(NotificationNotFoundError)

    expect((await listForUser(admin, 10, 0)).unread).toBe(1)
  })

  it('refuses an unknown id', async () => {
    await expect(markAsRead(String(new Types.ObjectId()), admin)).rejects.toThrow(
      NotificationNotFoundError,
    )
  })

  it('refuses a malformed id without reaching the database', async () => {
    await expect(markAsRead('not-an-object-id', admin)).rejects.toThrow(NotificationNotFoundError)
  })
})

describe('markAllReadForUser', () => {
  it('reads every one the caller can see, for the caller only', async () => {
    await seedSeries(3)

    await markAllReadForUser(admin)

    const mine = await listForUser(admin, 10, 0)
    expect(mine.items.every((i) => i.read)).toBe(true)
    expect(mine.unread).toBe(0)

    // The shared documents are untouched for everyone else.
    const theirs = await listForUser(otherAdmin, 10, 0)
    expect(theirs.items.every((i) => !i.read)).toBe(true)
    expect(theirs.unread).toBe(3)
  })

  it('leaves the notifications in the caller\u2019s list', async () => {
    await seedSeries(3)

    await markAllReadForUser(admin)

    const { items, total } = await listForUser(admin, 10, 0)
    expect(items).toHaveLength(3)
    expect(total).toBe(3)
  })

  // Reading everything is not dismissing: a new notification still arrives unread.
  it('does not stop a later notification arriving unread', async () => {
    await seedSeries(2)
    await markAllReadForUser(admin)

    await createNotification(forAllAdmins('Document 3 finished ingesting.'))

    expect(await countsForUser(admin)).toEqual({ total: 3, unread: 1 })
  })

  it('does not touch the other role', async () => {
    await createNotification({ ...forAllAdmins(), targetRole: 'risk_engineer' })

    await markAllReadForUser(admin)

    expect((await listForUser(engineer, 10, 0)).unread).toBe(1)
  })

  it('records each reader once, however many times they mark all read', async () => {
    const created = await createNotification(forAllAdmins())

    await markAllReadForUser(admin)
    await markAllReadForUser(admin)

    const stored = await NotificationModel.findById(created.id).lean()
    expect(stored!.readBy).toEqual([ADMIN_ID])
  })

  it('does nothing when there is nothing to read', async () => {
    await expect(markAllReadForUser(engineer)).resolves.toBeUndefined()
  })
})

describe('countsForUser', () => {
  it('counts the caller\u2019s notifications and how many are unread', async () => {
    await seedSeries(3)
    const { items } = await listForUser(admin, 10, 0)
    await markAsRead(items[0].id, admin)

    expect(await countsForUser(admin)).toEqual({ total: 3, unread: 2 })
  })

  it('is not affected by another user reading the same notification', async () => {
    const created = await createNotification(forAllAdmins())
    await markAsRead(created.id, otherAdmin)

    expect(await countsForUser(admin)).toEqual({ total: 1, unread: 1 })
  })

  it('is zero for a user with nothing to see', async () => {
    await createNotification(forAllAdmins())

    expect(await countsForUser(engineer)).toEqual({ total: 0, unread: 0 })
  })
})

describe('dismissAllForUser', () => {
  it('empties the caller\u2019s list and leaves another user\u2019s intact', async () => {
    await seedSeries(3)

    await dismissAllForUser(admin)

    expect(await listForUser(admin, 10, 0)).toEqual({ items: [], total: 0, unread: 0 })
    expect((await listForUser(otherAdmin, 10, 0)).items).toHaveLength(3)
  })

  // Dismissing is per user, so the shared document must survive it.
  it('keeps the notifications themselves', async () => {
    await seedSeries(3)

    await dismissAllForUser(admin)

    expect(await NotificationModel.countDocuments({})).toBe(3)
  })

  it('still shows a notification that arrives after dismissing', async () => {
    await seedSeries(2)
    await dismissAllForUser(admin)

    await createNotification(forAllAdmins('Document 3 finished ingesting.'))

    const { items, total } = await listForUser(admin, 10, 0)
    expect(messagesOf(items)).toEqual(['Document 3 finished ingesting.'])
    expect(total).toBe(1)
  })

  it('does not touch the other role', async () => {
    await createNotification({ ...forAllAdmins(), targetRole: 'risk_engineer' })

    await dismissAllForUser(admin)

    expect((await listForUser(engineer, 10, 0)).items).toHaveLength(1)
  })

  it('does nothing when there is nothing to dismiss', async () => {
    await expect(dismissAllForUser(engineer)).resolves.toBeUndefined()
  })
})
