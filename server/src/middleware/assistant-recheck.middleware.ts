// Queues a MarshBot re-check after any successful change to an assessment
// (AS-06, ADR .local-docs/adr/0002). Mounted in index.ts before the routers, so
// a teammate's new route is covered without remembering to call anything.
// Calls assistant/check-queue.service.ts.
import type { NextFunction, Request, Response } from 'express'
import { SESSION_COOKIE } from './auth.middleware'
import { queueAssessmentCheck } from '../services/assistant/check-queue.service'
import { assessmentReferencesOfObservation } from '../services/observation.service'
import { openReferencesOfClient, openReferencesOfClientDocument } from '../services/client.service'

// Which assessments a changed path belongs to. The assistant's own routes are
// included on purpose: its activity beacon can resolve "not read yet" reminders.
// `before` = look the assessments up before the route runs, for things a request can delete;
// otherwise after a 2xx, so a failed request costs no look-up.
const SCOPES: [RegExp, (id: string) => Promise<string[]>, before: boolean][] = [
  [/^\/api\/assessments\/([^/]+)/, async (reference) => [reference], true],
  [/^\/api\/observations\/([^/]+)/, assessmentReferencesOfObservation, true],
  // A client document can fill or reopen a Setup gap on each of the client's assessments.
  [/^\/api\/clients\/([^/]+)\/documents/, openReferencesOfClient, false],
  [/^\/api\/client-documents\/([^/]+)/, openReferencesOfClientDocument, true],
]

// Its references, or none when the look-up fails (a re-check is never worth failing the request).
function referencesOf(scope: (typeof SCOPES)[number], path: string): Promise<string[]> {
  return scope[1](scope[0].exec(path)![1]).catch((error: unknown) => {
    console.error('Finding the assessment to re-check failed:', error)
    return []
  })
}

/** Express middleware: on a 2xx non-GET response under an assessment's paths, queues its re-check. */
export async function assistantRecheck(req: Request, res: Response, next: NextFunction) {
  const reads = req.method === 'GET' || req.method === 'HEAD'
  const scope = SCOPES.find(([path]) => path.test(req.path))
  // No session cookie means a 401 is coming; without this, anyone could make us look things up.
  if (reads || !scope || !req.cookies?.[SESSION_COOKIE]) return next()
  // Resolved before the route runs: once an observation is deleted, its assessment can't be looked up.
  const path = req.path
  const early = scope[2] ? await referencesOf(scope, path) : null
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return
    void (early ? Promise.resolve(early) : referencesOf(scope, path)).then((references) =>
      references.forEach(queueAssessmentCheck),
    )
  })
  next()
}
