// Tests for smoothAdapter (UI/UX polish, part 1): letters paced per frame, hidden text
// passed at once, order kept, Stop ends at once.
import { EventType, type AGUIEvent } from '@openuidev/react-headless'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lettersPerFrame, readableScanner, smoothAdapter } from './smoothAdapter'

afterEach(() => vi.useRealTimers())

const text = (delta: string) =>
  ({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm', delta }) as AGUIEvent
const start = { type: EventType.TEXT_MESSAGE_START, messageId: 'm', role: 'assistant' } as AGUIEvent
const deltas = (out: AGUIEvent[]) =>
  out
    .filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
    .map((e) => (e as { delta: string }).delta)

// An inner adapter that yields the given events at once.
const adapterOf = (events: AGUIEvent[]) => ({
  async *parse() {
    yield* events
  },
})

async function collect(events: AGUIEvent[]) {
  const out: AGUIEvent[] = []
  const done = (async () => {
    for await (const e of smoothAdapter(adapterOf(events)).parse(new Response())) out.push(e)
  })()
  await vi.runAllTimersAsync()
  await done
  return out
}

const program =
  'root = Answer([s1])\ns1 = Statement("Spacing is 12 ft.", [Cite("P1", "twelve feet")])\n'

describe('readableScanner', () => {
  it('marks only the letters of a shown component’s text as readable', () => {
    const scan = readableScanner()
    const shown = [...program].filter((c) => scan(c)).join('')
    expect(shown).toBe('Spacing is 12 ft.')
  })
})

describe('smoothAdapter', () => {
  it('keeps order and the exact text, revealing readable letters a few per frame', async () => {
    vi.useFakeTimers()
    const out = await collect([start, text(program)])
    expect(out[0]).toBe(start)
    expect(deltas(out).join('')).toBe(program)
    // Code before the sentence and the citation after it never wait on their own frame.
    expect(deltas(out)[0]).toBe('root = Answer([s1])\ns1 = Statement("')
    expect(deltas(out).at(-1)).toContain('", [Cite("P1", "twelve feet")])\n')
    expect(deltas(out).length).toBeGreaterThan(10)
  })

  it('keeps the quote check line whole, so markers never show a half-done check', async () => {
    vi.useFakeTimers()
    const meta = '\nmeta = Meta([{label: "P1"}], [])\n'
    const out = await collect([text(program), text(meta)])
    expect(deltas(out).at(-1)).toContain(meta)
  })

  it('catches up with a long backlog: 3,000 letters show within about a second', async () => {
    vi.useFakeTimers()
    const long = `s1 = Statement("${'word '.repeat(600)}", [])\n`
    const t0 = Date.now()
    const out = await collect([text(long)])
    expect(deltas(out).join('')).toBe(long)
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  it('stops at once when the stream fails (Stop), without typing out the queue', async () => {
    vi.useFakeTimers()
    const failing = {
      async *parse() {
        yield text(`s1 = Statement("${'w '.repeat(200)}`)
        throw new DOMException('stopped', 'AbortError')
      },
    }
    const out: AGUIEvent[] = []
    const done = (async () => {
      for await (const e of smoothAdapter(failing).parse(new Response())) out.push(e)
    })().catch((e: Error) => e.name)
    await vi.runAllTimersAsync()
    expect(await done).toBe('AbortError')
    expect(deltas(out).join('').length).toBeLessThan(100)
  })

  it('slows to a fraction of a letter a frame when few wait, more as the backlog grows', () => {
    expect(lettersPerFrame(2)).toBe(0.25)
    expect(lettersPerFrame(240)).toBe(10)
  })
})
