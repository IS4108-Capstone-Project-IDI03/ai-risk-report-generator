// The gateway's background work (F-11): the signed-in user's long-running jobs,
// each one row, as GET /api/background-work serves them
// (server/src/services/background-work.service.ts). Read by useBackgroundWork.
import { request } from '../accounts/api'

export type BackgroundWorkRow = {
  id: string
  kind:
    | 'walk'
    | 'voice-note'
    | 'handwriting'
    | 'reading'
    | 'drafting'
    | 'ingestion'
    | 'document-decision'
    | 'request'
  state: 'queued' | 'running' | 'failed' | 'waiting_on_you'
  title: string
  // What the job belongs to: the assessment's site, or the knowledge base.
  context: { label: string; reference?: string }
  // `count` (pages, regions) and `stages` (recordings, parts) carry real
  // numbers; `working` is one AI call with no measurable progress.
  progress: {
    type: 'count' | 'stages' | 'working'
    current?: number
    total?: number
    unit?: string
    stage?: string
    step?: number
    steps?: number
  }
  // When the current step began, where the gateway knows it.
  startedAt?: string
  error?: string
  href: string
  // An existing route that starts a failed job again; absent when the user may not.
  retry?: { method: 'POST'; url: string }
}

export function getBackgroundWork(signal?: AbortSignal): Promise<{ rows: BackgroundWorkRow[] }> {
  return request<{ rows: BackgroundWorkRow[] }>('/api/background-work', { signal })
}
