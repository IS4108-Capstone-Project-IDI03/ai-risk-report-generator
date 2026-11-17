// Keeps the rag-service's copy of MarshBot's parts in step with this library (AS-06). The
// rag-service puts that text in the wording prompt and checks programs against these names, so
// a drift would let the model write parts the screen can't draw. Run
// `UPDATE_PROMPT=1 npx vitest run src/features/marshbot/library` to refresh it.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { marshbotPrompt } from './library'

// must match microservices/rag-service/app/assistant (the file the wording prompt reads)
const copy = resolve(
  process.cwd(),
  '../microservices/rag-service/app/assistant/marshbot_components.txt',
)

it("matches the rag-service's copy of MarshBot's component prompt", () => {
  const prompt = marshbotPrompt()
  if (process.env.UPDATE_PROMPT) writeFileSync(copy, prompt)
  // A Windows checkout gives the copy CRLF endings; compare line by line.
  expect(readFileSync(copy, 'utf8').replace(/\r\n/g, '\n')).toBe(prompt)
})
