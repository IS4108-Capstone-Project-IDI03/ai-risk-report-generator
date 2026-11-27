// Puts text in the chat box (CB-10 voice, CB-07 Ask again). Used by VoiceInput.tsx and
// QuestionFromLink.tsx.
import { COMPOSER_BOX } from './useComposerHosts'

/** Puts text in the chat box the way typing would, so OpenUI's own state sees it; false when
    the box isn't drawn yet. */
export function fillBox(text: string): boolean {
  const box = document.querySelector<HTMLTextAreaElement>(COMPOSER_BOX)
  if (!box) return false
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, text)
  box.dispatchEvent(new Event('input', { bubbles: true }))
  box.focus()
  return true
}
