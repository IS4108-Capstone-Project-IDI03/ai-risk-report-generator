import mongoose from 'mongoose'
import { config } from '../config'
import { KnowledgeDocumentModel } from './knowledge-document.model'

// Mongoose connection, driven by MONGODB_URI (never hardcode credentials).
export async function connectDb(): Promise<void> {
  await mongoose.connect(config.mongodbUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000,
  })

  const database = mongoose.connection.db

  if (!database) {
    throw new Error('MongoDB connection was created without a database')
  }

  await database.admin().command({ ping: 1 })

  console.log(`MongoDB connected: ${mongoose.connection.name}`)
  await buildKnowledgeDocumentIndex()
}

/**
 * Builds the unique file-fingerprint index (IN-07 AC1) and returns nothing.
 * Mongoose swallows a failed build, so if identical files already exist this
 * logs one clear error instead; it never throws or deletes data.
 */
export async function buildKnowledgeDocumentIndex(): Promise<void> {
  try {
    await KnowledgeDocumentModel.createIndexes()
  } catch (error) {
    const groups = await KnowledgeDocumentModel.aggregate([
      { $match: { status: { $in: ['queued', 'processing', 'complete'] } } },
      { $group: { _id: '$file.sha256', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: 'groups' },
    ]).catch(() => [])
    console.error(
      `knowledge_documents has ${groups[0]?.groups ?? 'some'} groups of identical files; ` +
        'the duplicate-upload race guard is off until they are removed. ' +
        `Remove the extra copies and restart. (${error})`,
    )
  }
}
