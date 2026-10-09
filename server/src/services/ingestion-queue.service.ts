// Puts one ingestion job on the Redis queue (IN-01). BullMQ is the queue
// library; Redis is where the queue lives. The job only carries the document
// ID; the Python worker (app/worker.py) reads the rest from MongoDB.
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

// Re-queues a document whose previous ingestion job finished (failed). BullMQ
// keeps the old job under jobId=documentId, and add() ignores a duplicate id,
// so the stale job is removed first; removing a job that is already gone is a
// no-op. The add then behaves exactly like a first upload.
export async function requeueIngestion(documentId: string): Promise<void> {
  await ingestionQueue().remove(documentId)
  await enqueueIngestion(documentId)
}

// Removes a queued ingestion job. BullMQ treats a missing job as a no-op.
// Active jobs may already be claimed by the worker, so MongoDB cancellation
// state remains the source of truth for those runs.
export async function removeIngestionJob(documentId: string): Promise<void> {
  await ingestionQueue().remove(documentId)
}

// Wakes the worker to finish a cancellation when the original ingestion job
// has already disappeared (for example after a worker restart). A live
// ingestion job still wins the race and performs its own cooperative cleanup;
// this job is then a harmless no-op.
export async function enqueueCancellationJob(documentId: string): Promise<void> {
  const timedOut = sleep(ADD_TIMEOUT_MS, undefined, { ref: false }).then(() => {
    throw new Error('The ingestion queue did not respond.')
  })
  await Promise.race([
    ingestionQueue().add(
      'cancel',
      { documentId, action: 'cancel' },
      { jobId: `cancel-${documentId}`, attempts: 1, removeOnComplete: true },
    ),
    timedOut,
  ])
}
