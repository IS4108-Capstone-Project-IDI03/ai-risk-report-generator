import mongoose from 'mongoose'

// A unique index rejected the write (MongoDB error 11000).
export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof mongoose.mongo.MongoServerError && error.code === 11000
}

// The field whose unique index rejected the write, e.g. 'email', so a caller
// with more than one unique field can tell which value is taken.
export function duplicateKeyField(error: unknown): string | undefined {
  if (!isDuplicateKeyError(error)) return undefined
  const { keyPattern } = error as mongoose.mongo.MongoServerError
  return Object.keys(keyPattern ?? {})[0]
}
