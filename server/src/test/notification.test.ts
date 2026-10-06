import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { NotificationModel } from '../models/notification.model'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// A complete, valid notification. Individual tests override fields as needed.
const validNotification = () => ({
  purpose: 'ingestion_status' as const,
  message: 'FM Global 2-0 failed during chunking.',
  details: 'No text could be read from this PDF. Upload a copy with selectable text.',
  targetRole: 'knowledge_admin' as const,
  targetUserIds: ['all'],
  createdByService: 'ingestion-service',
  context: { documentId: '6ab39017e45cf009e4507731', stage: 'chunking' },
})

describe('notifications model', () => {
  it('creates a valid notification and round-trips every field', async () => {
    const input = validNotification()
    const created = await NotificationModel.create(input)

    const found = await NotificationModel.findById(created._id).lean()
    expect(found).not.toBeNull()
    expect(found!.purpose).toBe('ingestion_status')
    expect(found!.message).toBe('FM Global 2-0 failed during chunking.')
    expect(found!.details).toBe(
      'No text could be read from this PDF. Upload a copy with selectable text.',
    )
    expect(found!.targetRole).toBe('knowledge_admin')
    expect(found!.targetUserIds).toEqual(['all'])
    expect(found!.createdByService).toBe('ingestion-service')
    expect(found!.context).toEqual({
      documentId: '6ab39017e45cf009e4507731',
      stage: 'chunking',
    })
    expect(found!.createdAt).toBeInstanceOf(Date)
    expect(found!.updatedAt).toBeInstanceOf(Date)
  })

  it('needs only a purpose, message, role and audience', async () => {
    const created = await NotificationModel.create({
      purpose: 'account_status',
      message: 'Your role changed to risk engineer.',
      targetRole: 'risk_engineer',
      targetUserIds: ['6ab39017e45cf009e4507731'],
    })

    const found = await NotificationModel.findById(created._id).lean()
    expect(found!.details).toBeUndefined()
    expect(found!.context).toBeUndefined()
  })

  it('rejects a notification with no purpose', async () => {
    const { purpose, ...rest } = validNotification()
    void purpose
    await expect(NotificationModel.create(rest)).rejects.toThrow(/validation/i)
  })

  it('rejects a notification with no message', async () => {
    const { message, ...rest } = validNotification()
    void message
    await expect(NotificationModel.create(rest)).rejects.toThrow(/validation/i)
  })

  it('rejects a notification with no target role', async () => {
    const { targetRole, ...rest } = validNotification()
    void targetRole
    await expect(NotificationModel.create(rest)).rejects.toThrow(/validation/i)
  })

  it('rejects a notification with no audience', async () => {
    const { targetUserIds, ...rest } = validNotification()
    void targetUserIds
    await expect(NotificationModel.create(rest)).rejects.toThrow(/validation/i)
  })

  // An empty array would be a notification nobody can ever see, so it is
  // rejected rather than stored and silently never shown.
  it('rejects an empty audience', async () => {
    await expect(
      NotificationModel.create({ ...validNotification(), targetUserIds: [] }),
    ).rejects.toThrow(/validation/i)
  })

  it('rejects a blank message', async () => {
    await expect(
      NotificationModel.create({ ...validNotification(), message: '   ' }),
    ).rejects.toThrow(/validation/i)
  })

  it('rejects an unknown purpose', async () => {
    await expect(
      // Deliberately invalid: cast past the enum type to test the schema's
      // runtime enum validation.
      NotificationModel.create({ ...validNotification(), purpose: 'bogus' as never }),
    ).rejects.toThrow(/validation/i)
  })

  it('rejects an unknown target role', async () => {
    await expect(
      NotificationModel.create({ ...validNotification(), targetRole: 'reviewer' as never }),
    ).rejects.toThrow(/validation/i)
  })

  it('starts with nobody having read or dismissed it, and no author', async () => {
    const created = await NotificationModel.create({
      purpose: 'ingestion_status',
      message: 'FM Global 2-0 finished ingesting.',
      targetRole: 'knowledge_admin',
      targetUserIds: ['all'],
    })

    const found = await NotificationModel.findById(created._id).lean()
    expect(found!.readBy).toEqual([])
    expect(found!.dismissedBy).toEqual([])
    expect(found!.createdBy).toBeNull()
    expect(found!.createdByService).toBeNull()
  })

  it('records the user who created it', async () => {
    const createdBy = new Types.ObjectId()
    const created = await NotificationModel.create({
      ...validNotification(),
      createdByService: undefined,
      createdBy,
    })

    const found = await NotificationModel.findById(created._id).lean()
    expect(String(found!.createdBy)).toBe(String(createdBy))
    expect(found!.createdByService).toBeNull()
  })

  it('keeps every purpose in the agreed set usable', async () => {
    for (const purpose of [
      'ingestion_status',
      'transcription_status',
      'drafting_status',
      'knowledge_document_status',
      'account_status',
      'assessment_status',
    ] as const) {
      const created = await NotificationModel.create({ ...validNotification(), purpose })
      expect(created.purpose).toBe(purpose)
    }
  })
})
