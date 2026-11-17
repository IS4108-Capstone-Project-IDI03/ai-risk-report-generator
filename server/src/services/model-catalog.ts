// S-01: the fixed list of models an admin can pick for each AI task, and the `.env` key each
// one needs. Used by settings.service.ts (lights, saving) and model-resolver.service.ts (calls).
// To add a model or provider: add one line here, plus the adapter in the Python service.
// Only models a service can really run are listed; model names come from `.env.example`.

export const MODEL_TASKS = [
  'transcription',
  'photo',
  'handwriting',
  'ocr',
  'drafting',
  'label_classifier',
  'site_walk_classifier',
  'qa',
] as const
export type ModelTask = (typeof MODEL_TASKS)[number]

export interface ModelOption {
  provider: string
  model: string
  label: string
  // The `.env` variable that must hold this option's key. OpenAI has three, one per use,
  // so the key belongs to the option, not the provider.
  keyEnv: string
  recommended?: boolean
}

export interface TaskCatalog {
  label: string
  // True when the service cannot switch model (Whisper): shown, but not changeable.
  fixed?: boolean
  // The `.env` variable the service falls back to when nothing is saved here.
  envDefault: string
  options: ModelOption[]
}

const CLAUDE_KEY = 'ANTHROPIC_API_KEY'
const opt = (
  provider: string,
  model: string,
  label: string,
  keyEnv: string,
  recommended = false,
): ModelOption => ({ provider, model, label, keyEnv, ...(recommended ? { recommended } : {}) })

export const MODEL_CATALOG: Record<ModelTask, TaskCatalog> = {
  transcription: {
    label: 'Voice transcription',
    fixed: true,
    envDefault: 'WHISPER_MODEL',
    options: [opt('openai', 'whisper-1', 'Whisper', 'OPENAI_API_KEY', true)],
  },
  photo: {
    label: 'Photo reading',
    envDefault: 'VISION_MODEL',
    options: [opt('gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 'GEMINI_API_KEY', true)],
  },
  handwriting: {
    label: 'Handwriting',
    envDefault: 'HANDWRITING_MODEL',
    options: [opt('gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 'GEMINI_API_KEY', true)],
  },
  ocr: {
    label: 'Table and formula OCR',
    envDefault: 'OCR_MODEL',
    options: [
      opt('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5', CLAUDE_KEY, true),
      opt('gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 'GEMINI_API_KEY'),
    ],
  },
  drafting: {
    label: 'Answers and drafting',
    envDefault: 'LLM_MODEL',
    options: [
      opt('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', CLAUDE_KEY, true),
      opt('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', CLAUDE_KEY),
    ],
  },
  label_classifier: {
    label: 'Label classifier',
    envDefault: 'LABEL_CLASSIFIER',
    options: [
      opt('typesafe', 'jev', 'Jev (Typesafe)', 'TYPESAFE_API_KEY', true),
      opt('openai', 'gpt-6-luna', 'GPT-6 Luna (decisions)', 'OPENAI_LABEL_API_KEY'),
    ],
  },
  site_walk_classifier: {
    label: 'Site-walk classifier (category, severity, place)',
    envDefault: 'SITE_WALK_CLASSIFIER',
    options: [opt('typesafe', 'jev', 'Jev (Typesafe)', 'TYPESAFE_API_KEY', true)],
  },
  qa: {
    label: 'QA check',
    envDefault: 'QA_MODEL',
    // A different provider from drafting is recommended: the check must be independent (EV-05).
    options: [
      opt('openai', 'gpt-6.1-sol', 'GPT-6.1 Sol', 'OPENAI_CHAT_API_KEY', true),
      opt('gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 'GEMINI_API_KEY'),
      opt('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', CLAUDE_KEY),
      opt('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', CLAUDE_KEY),
    ],
  },
}

/** Returns the stable id of an option, "provider:model", as saved in settings. */
export const optionId = (o: Pick<ModelOption, 'provider' | 'model'>) => `${o.provider}:${o.model}`

/** Returns the option with this id for the task, or undefined. */
export function findOption(task: ModelTask, id: string): ModelOption | undefined {
  return MODEL_CATALOG[task].options.find((o) => optionId(o) === id)
}

/** Returns true when the env var holds a real key: not empty, not the `REPLACE_ME` placeholder. */
export function keyIsSet(
  keyEnv: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[keyEnv]?.trim()
  return !!value && value !== 'REPLACE_ME'
}

/** Returns true when both options come from the same provider (the QA independence rule). */
export const sameProvider = (a: Pick<ModelOption, 'provider'>, b: Pick<ModelOption, 'provider'>) =>
  a.provider === b.provider
