// Generation's gateway calls (GN-13): read the drafting state, start a drafting run,
// and draft one part again from Review. Called by useGeneration.ts and Review.
// Calls server/src/routes/generation.routes.ts.
import { request } from '../api'
import type { GenerationDto } from './types'
import { started } from '../../background-work/started'

const generationPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/generation`

/** Returns the assessment's drafting state: steps, parts and the current checkpoint. */
export async function getGeneration(
  reference: string,
  signal?: AbortSignal,
): Promise<GenerationDto> {
  return (await request<GenerationDto>('GET', generationPath(reference), undefined, signal)).data
}

/** Starts the drafting run the current checkpoint offers; returns the state with the run queued. */
export async function startDraftingRun(reference: string): Promise<GenerationDto> {
  return (await started(request<GenerationDto>('POST', `${generationPath(reference)}/run`))).data
}

/** Drafts one part again in the background, from Review: Redraft for Section 2 and
    Section 3, Regenerate (with an optional instruction) for Sections 4 to 12.
    Returns the state with the part queued. */
export async function draftPart(
  reference: string,
  partId: string,
  instruction?: string | null,
): Promise<GenerationDto> {
  const path = `${generationPath(reference)}/parts/${encodeURIComponent(partId)}`
  return (await started(request<GenerationDto>('POST', path, { instruction: instruction ?? null })))
    .data
}
