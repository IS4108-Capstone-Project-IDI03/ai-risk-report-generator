// The two queues behind site walks and voice notes (CP-22). Called by
// observation.service.ts (voice notes) and site-walk*.service.ts (walks), each
// of which registers its handler here. Workers start in index.ts.
// Handlers register themselves, so this file imports neither service and no
// import cycle forms.
import { defineQueue, type JobHandler } from './job-queue.service'

export type TranscriptionJob =
  | { kind: 'site-walk'; walkId: string; seq: number }
  // A voice clip added to a walk's proposal by hand (round 3).
  | { kind: 'walk-media'; walkId: string; mediaId: string }
  | { kind: 'voice-note'; observationId: string; recordingId: string }

const transcriptionHandlers: {
  [K in TranscriptionJob['kind']]?: JobHandler<Extract<TranscriptionJob, { kind: K }>>
} = {}

/** Registers what runs for a transcription job of one kind. */
export function onTranscriptionJob<K extends TranscriptionJob['kind']>(
  kind: K,
  handler: JobHandler<Extract<TranscriptionJob, { kind: K }>>,
) {
  ;(transcriptionHandlers as Record<string, unknown>)[kind] = handler
}

// Concurrency 3 and 5 attempts from a 5 s exponential backoff, so a busy,
// rate-limited or timed-out speech service is retried, not shown to the engineer.
export const transcriptionQueue = defineQueue<TranscriptionJob>(
  'transcription',
  { concurrency: 3, attempts: 5, backoffMs: 5000 },
  (data, context) =>
    (transcriptionHandlers[data.kind] as JobHandler<TranscriptionJob> | undefined)?.(
      data,
      context,
    ) ?? Promise.resolve(),
)

export type ProposalJob = { walkId: string }
let proposalHandler: JobHandler<ProposalJob> | undefined

/** Registers what runs for a site-walk-proposal job. */
export function onProposalJob(handler: JobHandler<ProposalJob>) {
  proposalHandler = handler
}

// Queue of site-walk proposals; `add` queues one under a fixed id.
export const proposalQueue = defineQueue<ProposalJob>(
  'site-walk-proposal',
  { concurrency: 2, attempts: 3, backoffMs: 10_000 },
  (data, context) => proposalHandler?.(data, context) ?? Promise.resolve(),
)
