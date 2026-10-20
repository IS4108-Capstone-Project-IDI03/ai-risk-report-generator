// Keeps the rag-service's copy of the answer components in step with this library (CB-01).
// The rag-service puts that text in the answer prompt, so a drift would let the model write
// components the screen can't draw. Run `UPDATE_PROMPT=1 npx vitest run library` to refresh it.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { chatLibrary } from './library'

// must match microservices/rag-service/app/chat/answer.py (COMPONENTS_FILE)
const copy = resolve(process.cwd(), '../microservices/rag-service/app/chat/answer_components.txt')

it("matches the rag-service's copy of the component prompt", () => {
  const prompt = chatLibrary.prompt()
  if (process.env.UPDATE_PROMPT) writeFileSync(copy, prompt)
  // A Windows checkout gives the copy CRLF endings; the rag-service reads it with
  // universal newlines, so compare line by line, not ending by ending.
  expect(readFileSync(copy, 'utf8').replace(/\r\n/g, '\n')).toBe(prompt)
})
