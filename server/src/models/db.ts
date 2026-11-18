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
    await dropOutdatedFilters()
    await KnowledgeDocumentModel.createIndexes()
  } catch (error) {
    const groups = await KnowledgeDocumentModel.aggregate([
      { $match: { status: { $in: ['awaiting_type', 'queued', 'processing', 'complete'] } } },
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

// Drops each stored index whose name a schema index has but whose partial filter differs, so
// createIndexes builds it again with the schema's filter: MongoDB refuses to build an index
// under a name another filter already holds. IN-19 added `awaiting_type` to the fingerprint
// indexes' statuses, which every database built before then holds without.
async function dropOutdatedFilters(): Promise<void> {
  const stored = await KnowledgeDocumentModel.collection.indexes().catch(() => [])
  for (const [fields, options] of KnowledgeDocumentModel.schema.indexes()) {
    const name =
      (options.name as string | undefined) ??
      Object.entries(fields)
        .map(([key, direction]) => `${key}_${direction}`)
        .join('_')
    const existing = stored.find((index) => index.name === name)
    const wanted = options.partialFilterExpression ?? null
    if (
      existing &&
      JSON.stringify(existing.partialFilterExpression ?? null) !== JSON.stringify(wanted)
    ) {
      await KnowledgeDocumentModel.collection.dropIndex(name)
    }
  }
}
