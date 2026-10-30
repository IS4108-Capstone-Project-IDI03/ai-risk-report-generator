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

// One job id per document attempt (the document's retryCount): the original
// upload is the bare document id, retry n is `<id>-<n>`. BullMQ ignores an add
// whose id it still holds and cannot remove a job a worker is running, so a
// retry pressed while a cancelled run is still winding down needs its own id.
const jobId = (documentId: string, attempt: number) =>
  attempt ? `${documentId}-${attempt}` : documentId

// Queues one ingestion job for a stored document's attempt, so BullMQ ignores
// a second add for the same attempt. Rejects if Redis does not answer in time;
// an add that lands later is harmless, because the worker skips a document
// that no longer exists.
export async function enqueueIngestion(documentId: string, attempt = 0): Promise<void> {
  const timedOut = sleep(ADD_TIMEOUT_MS, undefined, { ref: false }).then(() => {
    throw new Error('The ingestion queue did not respond.')
  })
  await Promise.race([
    ingestionQueue().add(
      'ingest',
      { documentId },
      { jobId: jobId(documentId, attempt), attempts: 1 },
    ),
    timedOut,
  ])
}

// Re-queues a failed or cancelled document as attempt `attempt`. The previous
// attempt's job is removed first to keep Redis tidy; that is a no-op when it is
// gone, and returns 0 when a worker still holds it (a cancelled run winding
// down), which the worker handles by seeing the retryCount move on.
export async function requeueIngestion(documentId: string, attempt: number): Promise<void> {
  await ingestionQueue().remove(jobId(documentId, attempt - 1))
  await enqueueIngestion(documentId, attempt)
}

// Removes a queued ingestion job. BullMQ treats a missing job as a no-op.
// Active jobs may already be claimed by the worker, so MongoDB cancellation
// state remains the source of truth for those runs.
export async function removeIngestionJob(documentId: string, attempt = 0): Promise<void> {
  await ingestionQueue().remove(jobId(documentId, attempt))
}
