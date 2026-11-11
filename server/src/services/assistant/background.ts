// MarshBot's background work (AS-06): the wording and coverage calls and the
// export re-check, which never hold up a request. Tests wait for them with
// settleBackground, so nothing writes after a test's database is emptied.
const running = new Set<Promise<unknown>>()

/** Runs `work` without waiting for it; a failure is logged, never thrown. */
export function inBackground(label: string, work: Promise<unknown>): void {
  const tracked: Promise<unknown> = work
    .catch((error) => console.error(`MarshBot ${label} failed:`, error))
    .finally(() => running.delete(tracked))
  running.add(tracked)
}

/** Resolves once every background job, and any they started, has finished. */
export async function settleBackground(): Promise<void> {
  while (running.size) await Promise.all([...running])
}
