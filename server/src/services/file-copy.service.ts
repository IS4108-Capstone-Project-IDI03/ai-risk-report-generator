// Local copies of knowledge-base PDFs, so byte ranges are served in milliseconds (CB-02).
// Called by knowledge-document.service.ts. Calls storage.service.ts for the S3 download.
import { createReadStream, createWriteStream } from 'fs'
import { access, mkdir, rename } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { getObjectStream } from './storage.service'

// The chat's PDF viewer asks for ~200 small ranges of a big standard, some only after others
// arrive; each one from S3 took 45-130 ms, about 6 s in all for NFPA 25, while the whole 86 MB
// file comes down in under 2 s. Each copy is named by its file's sha256, so it can never go
// stale.
// ponytail: copies live in the temp folder and are never evicted (the knowledge base is a few
// hundred MB); add a size cap if it grows to several GB.
const COPIES = join(tmpdir(), 'knowledge-files')
const copying = new Map<string, Promise<string>>()

/** Returns the path of a local copy of the object, downloading it once on first use. */
function localCopy(key: string, name: string): Promise<string> {
  const path = join(COPIES, name)
  let copy = copying.get(path)
  if (!copy) {
    copy = (async () => {
      try {
        await access(path)
        return path
      } catch {
        // Not copied yet.
      }
      await mkdir(COPIES, { recursive: true })
      // Written under a temporary name and renamed when complete, so a half-written copy is
      // never served.
      const part = `${path}.${process.pid}.part`
      await pipeline(await getObjectStream(key), createWriteStream(part))
      await rename(part, path)
      return path
    })()
    // Concurrent requests share one download; a failed one isn't kept, so the next retries.
    copy.catch(() => copying.delete(path))
    copying.set(path, copy)
  }
  return copy
}

/** Returns the inclusive [first, last] byte range of the object, read from its local copy. */
export async function getObjectRangeStream(
  key: string,
  name: string,
  [first, last]: [number, number],
): Promise<Readable> {
  return createReadStream(await localCopy(key, name), { start: first, end: last })
}
