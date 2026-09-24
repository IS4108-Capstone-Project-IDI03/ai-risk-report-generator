import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import { afterAll, afterEach, beforeAll } from 'vitest'

// Runs the calling test file against a throwaway mongod, emptying every
// collection between tests.
export function useMemoryMongo() {
  let mongo: MongoMemoryServer | undefined

  beforeAll(async () => {
    // The first run downloads a mongod binary, hence the long timeout.
    mongo = await MongoMemoryServer.create()
    await mongoose.connect(mongo.getUri())
    // Unique indexes must exist before the tests that rely on them.
    await mongoose.syncIndexes()
  }, 120_000)

  afterEach(async () => {
    const collections = await mongoose.connection.db?.collections()
    await Promise.all((collections ?? []).map((collection) => collection.deleteMany({})))
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongo?.stop()
  })
}
