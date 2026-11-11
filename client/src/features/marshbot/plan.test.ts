// MarshBot's words split for the word-by-word reveal (AS-06): bold names, and no space added
// before punctuation that follows them.
import { expect, it } from 'vitest'
import { wordsOf } from './plan'

it('splits words, keeps **bold** names and glues the punctuation after them', () => {
  const words = wordsOf('Starting with **Loading Bay 2**; then **Fire**.')
  const said = words.map((w, i) => (i > 0 && !w.glued ? ' ' : '') + w.text).join('')
  expect(said).toBe('Starting with Loading Bay 2; then Fire.')
  expect(words.filter((w) => w.bold).map((w) => w.text)).toEqual(['Loading', 'Bay', '2', 'Fire'])
})
