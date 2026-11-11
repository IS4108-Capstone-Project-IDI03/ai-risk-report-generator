// Background queues for the gateway (CP-22): BullMQ jobs kept in Redis and
// worked by workers in this process. Called by background-queues.service.ts,
// which defines the two CP-22 queues, and client-intake.service.ts (CP-23's
// daily cleanup, a scheduled job). Started from index.ts (startWorkers).
// A restart loses nothing: jobs stay in Redis and are picked up again.
import { Queue, Worker } from 'bullmq'
import { setTimeout as sleep } from 'timers/promises'
import { config } from '../config'

export type JobContext = {
  // The handler records the final failure itself on this attempt; before it, a
  // throw makes BullMQ retry after the backoff.
  isLastAttempt: boolean
}
export type JobHandler<T> = (data: T, context: JobContext) => Promise<void>

type QueueOptions = { concurrency: number; attempts: number; backoffMs: number }

type Definition<T> = {
  name: string
  options: QueueOptions
  handler: JobHandler<T>
  queue?: Queue
}

// BullMQ waits for Redis indefinitely; adding a job should fail instead.
const ADD_TIMEOUT_MS = 3000

const definitions: Definition<never>[] = []

// Under tests there is no Redis: a job runs in this process straight away, with
// `inlineAttempts` tries and no wait between them. Tests set the count with
// setInlineAttempts and wait for running jobs with drainInlineJobs.
const inline = () => process.env.NODE_ENV === 'test'
let inlineAttempts = 1
const running = new Set<Promise<void>>()

/** Sets how many tries a job gets under tests (default 1). */
export function setInlineAttempts(attempts: number) {
  inlineAttempts = attempts
}

/** Waits until every job started under tests has finished. */
export async function drainInlineJobs() {
  while (running.size) await Promise.all([...running])
}

async function runInline<T>(definition: Definition<T>, data: T) {
  for (let made = 0; made < inlineAttempts; made++) {
    const isLastAttempt = made === inlineAttempts - 1
    try {
      await definition.handler(data, { isLastAttempt })
      return
    } catch (error) {
      if (isLastAttempt) console.error(`Queue ${definition.name}:`, error)
    }
  }
}

/**
 * Defines a queue and what runs for each of its jobs. Returns `add`, which
 * queues a job under a fixed id: BullMQ ignores an add whose id it still holds,
 * so queueing the same work twice runs it once. A finished job is removed, but
 * only once its handler returns, so a retry passes `retryJobId(id)` instead:
 * without it, a Retry pressed while the failed job is still finishing would be
 * dropped as a duplicate and the work would never run.
 */
export function defineQueue<T extends object>(
  name: string,
  options: QueueOptions,
  handler: JobHandler<T>,
) {
  const definition: Definition<T> = { name, options, handler }
  definitions.push(definition as Definition<never>)

  // Created on first use, so importing the app (e.g. in tests) opens no Redis connection.
  const queueOf = () => {
    if (!definition.queue) {
      definition.queue = new Queue(name, { connection: { url: config.redisUrl } })
      // Without a listener, a connection error event would crash the gateway.
      definition.queue.on('error', (error) => console.error(`Queue ${name}:`, error.message))
    }
    return definition.queue
  }

  return {
    // `delayMs` holds the job back, e.g. to gather a burst under one id (AS-06).
    async add(jobId: string, data: T, delayMs = 0): Promise<void> {
      if (inline()) {
        const job = runInline(definition, data).finally(() => running.delete(job))
        running.add(job)
        return
      }
      const timedOut = sleep(ADD_TIMEOUT_MS, undefined, { ref: false }).then(() => {
        throw new Error(`The ${name} queue did not respond.`)
      })
      await Promise.race([
        queueOf().add(name, data, {
          jobId,
          delay: delayMs,
          attempts: options.attempts,
          backoff: { type: 'exponential', delay: options.backoffMs },
          removeOnComplete: true,
          removeOnFail: true,
        }),
        timedOut,
      ])
    },
    /**
     * Runs a job on a cron schedule, e.g. '0 3 * * *' daily at 03:00 UTC, kept
     * in Redis under `schedulerId`; calling it again replaces the schedule, so
     * every boot can call it. Does nothing under tests, which call the handler's
     * work directly.
     */
    async schedule(schedulerId: string, pattern: string, data: T): Promise<void> {
      if (inline()) return
      await queueOf().upsertJobScheduler(
        schedulerId,
        { pattern },
        {
          name,
          data,
          opts: { attempts: options.attempts, removeOnComplete: true, removeOnFail: true },
        },
      )
    },
  }
}

/** Returns a fresh job id for retrying the job queued under `jobId`. */
export const retryJobId = (jobId: string) => `${jobId}-retry-${Date.now()}`

/** Starts a worker for every defined queue. Called once the gateway boots. */
export function startWorkers() {
  for (const definition of definitions) {
    const { name, options, handler } = definition
    const worker = new Worker(
      name,
      (job) =>
        handler(job.data as never, { isLastAttempt: job.attemptsMade + 1 >= options.attempts }),
      { connection: { url: config.redisUrl }, concurrency: options.concurrency },
    )
    worker.on('error', (error) => console.error(`Worker ${name}:`, error.message))
  }
}
