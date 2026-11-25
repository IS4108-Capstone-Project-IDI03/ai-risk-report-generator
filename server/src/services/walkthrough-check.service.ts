// F-12: the quick check before a try-it (a walkthrough step that calls live AI).
// Called by routes/walkthrough.routes.ts. Calls each needed service's health route, then one
// tiny provider request; a pass is remembered for 5 minutes, a fail for 30 s. Sends no client text.
import { config } from '../config'
import { recordAiCalls } from './ai-usage.service'
import type { SessionUser } from './auth.service'
import { modelHeaders } from './model-resolver.service'

// One outbound call. `provider` calls make a small real request at the AI provider (and
// answer `{ok, usage}`); the rest are plain health routes.
type Check = { id: string; url: string; provider?: boolean; headers?: boolean }

const rag = (need: string): Check => ({
  id: `rag:${need}`,
  url: `${config.ragServiceUrl}/health/providers?need=${need}`,
  provider: true,
  // The admin's model for drafting, so the model that will really answer is the one tested.
  headers: need === 'llm',
})
const health = (id: string, base: string): Check => ({ id, url: `${base}/health` })
const ingestion = () => health('ingestion', config.ingestionServiceUrl)
const ragUp = () => health('rag', config.ragServiceUrl)
const speech = () => [
  health('speech', config.speechOcrServiceUrl),
  {
    id: 'speech:stt',
    url: `${config.speechOcrServiceUrl}/health/providers`,
    provider: true,
  },
]

// What each try-it needs working (spec Architecture 7). Search needs Chroma and the embedding
// provider; chat has its own language model, the rest use the drafting one.
const NEEDS: Record<string, () => Check[]> = {
  'new-docs': () => [ingestion(), ragUp(), rag('llm')],
  'new-observation': () => [...speech(), ragUp(), rag('llm')],
  'split-note': () => [ragUp(), rag('llm')],
  'site-walk': () => [...speech(), ragUp(), rag('llm')],
  ask: () => [ragUp(), rag('search'), rag('llm')],
  chat: () => [ragUp(), rag('search'), rag('chat')],
}

const HEALTH_TIMEOUT_MS = 5_000
// 15 s, not 10: the first call after rag-service starts took 7 to 8 s live (it loads its model
// libraries), later ones 1 to 3 s.
const PROVIDER_TIMEOUT_MS = 15_000
const PASS_KEPT_MS = 5 * 60_000
const FAIL_KEPT_MS = 30_000

// The last answer per set of checks (and drafting model), and until when it stands. A fail is
// kept briefly: without it, every request while a service is down would pay for the pings again.
const kept = new Map<string, { ok: boolean; until: number }>()
// The check running now per key, shared by every request that arrives meanwhile.
const running = new Map<string, Promise<boolean>>()

/** Forgets every remembered answer; returns nothing. For tests. */
export function forgetTryItPasses(): void {
  kept.clear()
  running.clear()
}

// Runs one call with a timeout; true only when the service answered OK. Never throws:
// without this, a down service would turn the route into a 500 instead of "not ready".
async function run(
  check: Check,
  user: SessionUser,
  headers?: Record<string, string>,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    check.provider ? PROVIDER_TIMEOUT_MS : HEALTH_TIMEOUT_MS,
  )
  try {
    const response = await fetch(check.url, {
      headers: check.headers ? headers : undefined,
      signal: controller.signal,
    })
    if (!response.ok) return false
    if (!check.provider) return true
    const body = (await response.json()) as { ok?: boolean; usage?: object[] }
    // A paid call is recorded under "Walkthrough" for this user, even when it then failed.
    if (body.usage?.length) {
      await recordAiCalls(
        body.usage.map((u) => ({ ...u, feature: 'walkthrough' })),
        { userId: user.id },
      )
    }
    return body.ok === true
  } catch (error) {
    console.error(`Walkthrough check ${check.id} failed:`, error)
    return false
  } finally {
    clearTimeout(timer)
  }
}

// The free health routes first, and the paid provider pings only when they all pass; the
// answer is kept under `key`.
async function runAll(
  checks: Check[],
  user: SessionUser,
  headers: Record<string, string> | undefined,
  key: string,
): Promise<boolean> {
  const all = async (list: Check[]) =>
    (await Promise.all(list.map((c) => run(c, user, headers)))).every(Boolean)
  const ok =
    (await all(checks.filter((c) => !c.provider))) && (await all(checks.filter((c) => c.provider)))
  kept.set(key, { ok, until: Date.now() + (ok ? PASS_KEPT_MS : FAIL_KEPT_MS) })
  return ok
}

/** Returns whether the services this walkthrough's try-it needs are working; null when the walkthrough has no try-it. */
export async function tryItReady(walkthrough: string, user: SessionUser): Promise<boolean | null> {
  const needs = Object.hasOwn(NEEDS, walkthrough) ? NEEDS[walkthrough] : undefined
  if (!needs) return null
  const checks = needs()
  // Whenever client details are masked, privacy-service must be up too; only the Python
  // services know its URL, so rag-service checks it.
  if (config.piiProtection !== 'off') checks.push(rag('privacy'))
  // The admin's drafting model is part of the key: without it, a pass for one model would
  // vouch for another after the admin switches.
  let headers: Record<string, string> | undefined
  try {
    headers = checks.some((c) => c.headers) ? await modelHeaders('drafting') : undefined
  } catch (error) {
    console.error('Walkthrough check could not read the drafting model:', error)
    return false
  }
  const key = [...checks.map((c) => c.id).sort(), JSON.stringify(headers ?? {})].join()
  const known = kept.get(key)
  if (known && known.until > Date.now()) return known.ok

  let check = running.get(key)
  if (!check) {
    check = runAll(checks, user, headers, key).finally(() => running.delete(key))
    running.set(key, check)
  }
  return check
}
