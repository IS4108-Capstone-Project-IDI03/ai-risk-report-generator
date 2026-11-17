// S-01 AC9: the QA check, a stub until EV-05 builds it. It already refuses to run when the
// QA model shares a provider with report generation. Called by routes/qa.routes.ts.
import { assertQaCanRun } from './settings.service'

export class QaNotBuiltError extends Error {
  constructor() {
    super('The QA check is not built yet (EV-05).')
    this.name = 'QaNotBuiltError'
  }
}

/** Runs the QA check: refuses on a same-provider model, else says it is not built yet. */
export async function runQaCheck(): Promise<never> {
  await assertQaCanRun()
  throw new QaNotBuiltError()
}
