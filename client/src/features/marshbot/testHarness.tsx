// A test stand-in for the Overview's wiring (AS-06 round 9): it runs the reveal queue the way
// screens/MarshBotOverview.tsx does, then draws Thread. Used by marshbot.test.tsx and thread.test.tsx.
import type { ComponentProps } from 'react'
import { Thread } from './components/thread/Thread'
import { useReveal } from './components/thread/useReveal'

/** Returns a Thread with its own reveal queue, for tests that draw the thread alone. */
export function ThreadHarness(props: Omit<ComponentProps<typeof Thread>, 'reveal'>) {
  const reveal = useReveal(props.thread, !!props.pending)
  return <Thread {...props} reveal={reveal} />
}
