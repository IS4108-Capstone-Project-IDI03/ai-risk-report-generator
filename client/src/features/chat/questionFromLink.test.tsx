// "Ask again" on a filled knowledge request (CB-07) queues its question: it goes in the chat
// box for the engineer to send, when the chat opens or while it is already open.
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { queueQuestion } from './askAgain'
import { QuestionFromLink } from './components/QuestionFromLink'

// OpenUI's composer, as components/useComposerHosts.ts finds it.
const COMPOSER =
  '<div class="knowledge-assistant"><div class="openui-agent-thread-composer"><textarea></textarea></div></div>'
const box = () => document.querySelector('textarea')!

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

it('fills the chat box with a question queued before the chat opened', () => {
  document.body.innerHTML = COMPOSER
  queueQuestion('OH2 density?')
  render(<QuestionFromLink />)
  expect(box().value).toBe('OH2 density?')
})

it('fills the chat box with a question queued while the chat is open', () => {
  document.body.innerHTML = COMPOSER
  render(<QuestionFromLink />)
  queueQuestion('NFPA 25 intervals?')
  expect(box().value).toBe('NFPA 25 intervals?')
})
