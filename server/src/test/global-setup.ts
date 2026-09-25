import { MongoBinary } from 'mongodb-memory-server-core'

// Vitest runs test files in parallel workers. If each worker downloads the
// mongod binary itself, the downloads race on the same cache file and one
// hangs (ENOENT on rename). Download it once here, before any worker starts;
// useMemoryMongo() then finds it in the cache.
export default async function setup() {
  await MongoBinary.getPath()
}
