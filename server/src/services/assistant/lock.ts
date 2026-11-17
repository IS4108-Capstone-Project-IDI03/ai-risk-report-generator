// One piece of work at a time per key (AS-06): re-checks per assessment, and
// conversation advances per thread. Called by recheck.service.ts and
// thread.service.ts. Its own module so neither imports the other for it.
// shortcut: an in-process lock, right while one gateway process saves briefs; a Redis lock if it runs as several.
const chains = new Map<string, Promise<unknown>>()

/**
 * Returns `work`'s result, run only after every earlier call for the same
 * assessment has finished. Without this, two re-checks could save out of
 * order and an older brief would overwrite a newer one.
 */
export function oneAtATime<T>(reference: string, work: () => Promise<T>): Promise<T> {
  const run = (chains.get(reference) ?? Promise.resolve()).catch(() => {}).then(work)
  chains.set(reference, run)
  // Forgotten once the last one finishes, so the map doesn't grow per assessment.
  void run.catch(() => {}).finally(() => chains.get(reference) === run && chains.delete(reference))
  return run
}
