// S-01: turns the admin's model choice into the `X-Model` header the AI services read.
// Called by rag.service.ts (drafting) and speech.service.ts (photo, handwriting). Calls
// settings.service.ts `resolveModel`. The header name must match
// microservices/*/app/model_override.py.
import { resolveModel } from './settings.service'
import type { ModelTask } from './model-catalog'

/**
 * Returns the headers that tell an AI service which model to use for `task`.
 * Read on every call, so a saved choice applies at once. Empty when nothing is saved. Throws ModelUnavailableError
 * (answered as 503) when its key is missing: without this the service would quietly
 * use its `.env` model instead.
 */
export async function modelHeaders(task: ModelTask): Promise<Record<string, string>> {
  const { model, saved } = await resolveModel(task)
  // Only a saved choice is sent; otherwise the service keeps its own `.env` model unchanged.
  return saved ? { 'X-Model': model } : {}
}
