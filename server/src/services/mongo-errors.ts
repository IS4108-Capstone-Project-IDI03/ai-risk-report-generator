import mongoose from 'mongoose'

// A unique index rejected the write (MongoDB error 11000).
export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof mongoose.mongo.MongoServerError && error.code === 11000
}
