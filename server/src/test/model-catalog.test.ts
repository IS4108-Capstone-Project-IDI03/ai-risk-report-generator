import { describe, expect, it } from 'vitest'
import {
  MODEL_CATALOG,
  MODEL_TASKS,
  keyIsSet,
  optionId,
  sameProvider,
} from '../services/model-catalog'

// S-01 AC3, AC4, AC7: the fixed list of models per task, and whether each one's key is set.
describe('the model catalog (S-01)', () => {
  it('marks exactly one option per task as recommended', () => {
    for (const task of MODEL_TASKS) {
      const recommended = MODEL_CATALOG[task].options.filter((o) => o.recommended)
      expect(recommended, task).toHaveLength(1)
    }
  })

  it('has unique option ids within a task', () => {
    for (const task of MODEL_TASKS) {
      const ids = MODEL_CATALOG[task].options.map(optionId)
      expect(new Set(ids).size, task).toBe(ids.length)
    }
  })

  it('lists Whisper alone for transcription, and says it is fixed in code (AC7)', () => {
    expect(MODEL_CATALOG.transcription.fixed).toBe(true)
    expect(MODEL_CATALOG.transcription.options.map((o) => o.model)).toEqual(['whisper-1'])
  })

  it('counts a key as set only when it is real, not empty or a placeholder (AC4)', () => {
    expect(keyIsSet('GEMINI_API_KEY', { GEMINI_API_KEY: 'AIza-real' })).toBe(true)
    expect(keyIsSet('GEMINI_API_KEY', {})).toBe(false)
    expect(keyIsSet('GEMINI_API_KEY', { GEMINI_API_KEY: '' })).toBe(false)
    expect(keyIsSet('GEMINI_API_KEY', { GEMINI_API_KEY: '  ' })).toBe(false)
    expect(keyIsSet('GEMINI_API_KEY', { GEMINI_API_KEY: 'REPLACE_ME' })).toBe(false)
  })

  it('compares providers, not model names, for the QA rule (AC8)', () => {
    const [opus, sonnet] = MODEL_CATALOG.drafting.options
    expect(sameProvider(opus, sonnet)).toBe(true)
    const other = MODEL_CATALOG.qa.options.find((o) => o.provider !== opus.provider)!
    expect(sameProvider(opus, other)).toBe(false)
  })
})
