import { Queue } from 'bullmq'
import { setTimeout as sleep } from 'timers/promises'
import { config } from '../config'

// The ingestion worker (microservices/ingestion-service/app/worker.py)
// consumes this queue. Python and Node BullMQ share the queue format.
const INGESTION_QUEUE = 'ingestion'

// BullMQ waits for Redis indefinitely; an upload should fail instead.
const ADD_TIMEOUT_MS = 3000

let queue: Queue | undefined

function ingestionQueue(): Queue {
  // Created on first use, so importing the app (e.g. in tests) opens no
  // Redis connection.
  if (!queue) {
    queue = new Queue(INGESTION_QUEUE, { connection: { url: config.redisUrl } })
    // Without a listener, a connection error event would crash the gateway.
    queue.on('error', (error) => console.error('Ingestion queue:', error.message))
  }
  return queue
}

// Queues one ingestion job for a stored document. The job id is the document
// id, so BullMQ ignores a second add for the same document. Rejects if Redis
// does not answer in time; an add that lands later is harmless, because the
// worker skips a document that no longer exists.
export async function enqueueIngestion(documentId: string): Promise<void> {
  const timedOut = sleep(ADD_TIMEOUT_MS, undefined, { ref: false }).then(() => {
    throw new Error('The ingestion queue did not respond.')
  })
  await Promise.race([
    ingestionQueue().add('ingest', { documentId }, { jobId: documentId, attempts: 1 }),
    timedOut,
  ])
}
