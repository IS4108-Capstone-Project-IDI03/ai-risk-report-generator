// Evens out the answer stream (UI/UX polish, part 1). Wraps the AG-UI adapter in api.ts:
// the answer's readable letters are released a few per frame at a steady rate, like a
// typewriter, while text the reader never sees (code, citation quotes, the quote check's
// `meta` line) passes at once, so there are no silent gaps between sentences.
import { EventType, type AGUIEvent, type StreamProtocolAdapter } from '@openuidev/react-headless'

const FRAME_MS = 16 // one screen frame
// Each frame shows 1/CATCH_UP of the letters waiting, so the reveal keeps pace with any model
// speed and trails it by about CATCH_UP frames (~0.4s). The rate may fall below one letter a
// frame, so while the model writes a hidden citation the text slows instead of stopping.
// Once the model has finished, the rest catches up faster (FINISH_UP frames).
const CATCH_UP = 24
const FINISH_UP = 8
const MIN_RATE = 0.25 // letters a frame (~15 a second), so the last few letters still flow
// Components whose text argument is shown to the reader (must match ./library.tsx).
const SHOWN = new Set(['Statement', 'Cell', 'FollowUp'])

/** Returns how many readable letters (may be a fraction) to show a frame, given how many wait. */
export function lettersPerFrame(waiting: number, ended = false): number {
  return Math.max(ended ? 1 : MIN_RATE, waiting / (ended ? FINISH_UP : CATCH_UP))
}

/**
 * Returns a scanner that says whether each letter of the program is readable: inside a
 * string of a shown component. It keeps its place, so the program can arrive in pieces.
 */
export function readableScanner() {
  const open: string[] = [] // open calls (their component name) and brackets, innermost last
  let word = '' // the name just before a "(" is the call's component
  let quote = ''
  let escaped = false
  return (c: string): boolean => {
    if (quote) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) {
        quote = ''
        return false
      }
      return SHOWN.has(open[open.length - 1] ?? '')
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') open.push(word)
    else if (c === '[' || c === '{') open.push(c)
    else if (c === ')' || c === ']' || c === '}') open.pop()
    word = /\w/.test(c) ? word + c : ''
    return false
  }
}

type Letter = { event: AGUIEvent; c: string; readable: boolean }

/** Returns an adapter that yields the inner adapter's events, readable letters paced per frame. */
export function smoothAdapter(inner: StreamProtocolAdapter): StreamProtocolAdapter {
  return {
    async *parse(response) {
      const source = inner.parse(response)[Symbol.asyncIterator]()
      const queue: (AGUIEvent | Letter)[] = [] // events, and the text cut into letters
      const isLetter = (x: AGUIEvent | Letter | undefined): x is Letter => !!x && 'c' in x
      let waiting = 0 // readable letters queued
      let credit = 0 // letters earned toward the next frame (rates can be fractions)
      let ended = false
      let failure: unknown
      let wake = () => {}
      const readable = readableScanner()
      // The pump reads ahead on its own so the model is never slowed by the reveal pace.
      void (async () => {
        try {
          for (let r = await source.next(); !r.done; r = await source.next()) {
            const e = r.value
            if (e.type === EventType.TEXT_MESSAGE_CONTENT) {
              for (const c of e.delta) {
                const letter = { event: e, c, readable: readable(c) }
                if (letter.readable) waiting++
                queue.push(letter)
              }
            } else queue.push(e)
            wake()
          }
        } catch (err) {
          failure = err
        }
        ended = true
        wake()
      })()
      try {
        while (queue.length || !ended) {
          // Stop (an aborted fetch) ends the reveal at once instead of typing out the queue.
          if (failure) throw failure
          const head = queue[0]
          if (!head) {
            await new Promise<void>((resolve) => (wake = resolve))
            continue
          }
          if (!isLetter(head)) {
            yield queue.shift() as AGUIEvent
            continue
          }
          // a. This frame's text: hidden letters pass free, readable ones up to the whole
          // letters earned so far. A hidden tab shows no frames, so it takes everything.
          credit = Math.min(credit + lettersPerFrame(waiting, ended), waiting)
          let budget = document.hidden ? Infinity : Math.floor(credit)
          let delta = ''
          while (isLetter(queue[0]) && (!queue[0].readable || budget > 0)) {
            const letter = queue.shift() as Letter
            if (letter.readable) {
              budget--
              credit--
              waiting--
            }
            delta += letter.c
          }
          if (delta) yield { ...head.event, delta } as AGUIEvent
          // b. Then wait for the next frame.
          if (budget !== Infinity) await new Promise((r) => setTimeout(r, FRAME_MS))
        }
        if (failure) throw failure
      } finally {
        // Releases the inner reader; the fetch abort is what stops the network read itself.
        void source.return?.()
      }
    },
  }
}
