// F-12: request rules for the practice assessment (ADR 0003). practiceGate (mounted in
// index.ts) keeps every /api/assessments/:reference route closed to anyone but its owner;
// practiceRecordGate does the same for routes that name a record by id (observations,
// clients, sites, client documents); walkthroughUsage marks a request whose AI calls count
// as walkthrough usage. Calls assessment.service.ts (canOpenAssessment), practice/access.service.ts
// and ai-usage.service.ts (walkthroughRequest).
import type { NextFunction, Request, Response } from 'express'
import { canOpenAssessment } from '../services/assessment.service'
import { walkthroughRequest } from '../services/ai-usage.service'
import { verifySession } from '../services/auth.service'
import { canReachRecord, type RecordKind } from '../services/practice/access.service'
import { isPracticeReference } from '../services/practice/filter'
import { SESSION_COOKIE } from './auth.middleware'

/**
 * Express middleware: answers 404 for a practice assessment the signed-in user doesn't own, or
 * one that is hidden. Mounted after the session check and in front of every per-assessment
 * router, so a teammate's new route is covered too. A real reference costs no look-up.
 */
export async function practiceGate(req: Request, res: Response, next: NextFunction) {
  const { reference } = req.params as { reference: string }
  if (!isPracticeReference(reference) || (await canOpenAssessment(reference, res.locals.user!)))
    return next()
  res.status(404).json({ error: `Assessment ${reference} was not found.` })
}

const NOT_FOUND: Record<RecordKind, string> = {
  observation: 'The observation was not found.', // as ObservationNotFoundError
  client: 'This client was not found.',
  site: 'This site was not found.',
  'client-document': 'This document was not found.', // as ClientDocumentNotFoundError
}

/**
 * Returns a router.param handler for `:id` that answers 404, as if it did not exist, for a
 * practice record the signed-in user doesn't own. Used with router.param('id', ...) so every
 * route of that router is covered, a teammate's new one too. A real record costs one look-up.
 */
export function practiceRecordGate(kind: RecordKind) {
  return async (_req: Request, res: Response, next: NextFunction, id: string) => {
    if (await canReachRecord(kind, id, res.locals.user!)) return next()
    res.status(404).json({ error: NOT_FOUND[kind] })
  }
}

// The reference in an assessment's path; a practice one covers calls that name no assessment,
// e.g. dictating into it.
const ASSESSMENT_PATH = /^\/api\/assessments\/([^/]+)/

// The try-its with no assessment, by walkthrough id, and the one route each calls while it runs.
// Must match client/src/features/chat/api.ts and client/src/features/new-assessment/api.ts
// (the ids are those features' walkthroughs.ts ids).
const TRY_IT_ROUTES: Record<string, RegExp> = {
  chat: /^\/api\/chat\/?$/,
  'new-docs': /^\/api\/client-intakes(\/[^/]+\/read)?\/?$/,
}

// The header counts only with a known id on that try-it's route: without this, any request
// carrying it (a real assessment's drafting, say) would lose its cost to the walkthrough.
function markedTryIt(req: Request): boolean {
  const id = req.headers['x-walkthrough']
  return (
    typeof id === 'string' && Object.hasOwn(TRY_IT_ROUTES, id) && TRY_IT_ROUTES[id].test(req.path)
  )
}

/**
 * Express middleware: runs the rest of the request with walkthroughRequest set when the client
 * marks it with `x-walkthrough` (a try-it with no assessment is running) or it works on a
 * practice assessment. It holds who is signed in, so a call that names no user is still theirs.
 */
export function walkthroughUsage(req: Request, _res: Response, next: NextFunction) {
  const marked = markedTryIt(req) || isPracticeReference(ASSESSMENT_PATH.exec(req.path)?.[1])
  if (!marked) return next()
  let userId: string | undefined
  try {
    userId = verifySession(req.cookies?.[SESSION_COOKIE]).id
  } catch {
    // No valid session: the route's own check answers 401, so nothing is recorded anyway.
  }
  walkthroughRequest.run({ userId }, next)
}
