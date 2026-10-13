// Watches the chat stream for its closing chat_result event and saves the usage
// it carries (CB-01, EV-03). Called by routes/chat.routes.ts. Calls ai-usage.service.ts.
import { Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { recordAiCalls } from './ai-usage.service'

/** Returns a pass-through stream that records the usage of any chat_result event passing by. */
export function chatUsageTap(): Transform {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  // Looks at each complete event (events end with a blank line).
  const scan = (text: string) => {
    pending += text
    const events = pending.split('\n\n')
    pending = events.pop() ?? ''
    for (const event of events) {
      if (!event.includes('"chat_result"')) continue
      try {
        const data = JSON.parse(event.replace(/^data: ?/, ''))
        // Not awaited: a slow or failed save must not hold up the answer. It never throws.
        if (data.name === 'chat_result') void recordAiCalls(data.value?.usage)
      } catch {
        // Not valid JSON: leave it to the client; there is nothing to record.
      }
    }
  }
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      // Pass the bytes on first, untouched; the scan is a side look only.
      done(null, chunk)
      scan(decoder.write(chunk))
    },
  })
}
