// The in-process channel that tells open Overviews their brief changed (AS-06).
// Called by recheck.service.ts after it saves a brief. Listened to by the
// assistant events route (server-sent events) for each open Overview.
import { EventEmitter } from 'node:events'

// shortcut: one gateway process only; move to Redis pub/sub if the gateway ever runs as several instances.
const bus = new EventEmitter()
// One listener per open Overview; without this, Node warns after 10.
bus.setMaxListeners(0)

/** Tells every open Overview of `reference` that its brief changed; returns nothing. */
export function publishBriefChanged(reference: string, updatedAt: string): void {
  bus.emit(reference, updatedAt)
}

/** Returns whether any Overview of `reference` is open now (a server-sent event stream is listening). */
export function isWatched(reference: string): boolean {
  return bus.listenerCount(reference) > 0
}

/** Calls `listener` whenever `reference`'s brief changes; returns the unsubscribe function. */
export function onBriefChanged(
  reference: string,
  listener: (updatedAt: string) => void,
): () => void {
  bus.on(reference, listener)
  return () => bus.off(reference, listener)
}
