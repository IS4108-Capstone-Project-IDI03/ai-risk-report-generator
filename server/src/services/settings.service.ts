// S-01: reads and saves the Settings (models, QA strictness, personal values) and tells
// the AI calls which model to use. Called by routes/settings.routes.ts and
// qa.service.ts; the AI-calling services ask `resolveModel`. Never returns an API key,
// only whether one is set.
import {
  AppSettingsModel,
  QA_STRICTNESS,
  type IAppSettings,
  type PersonalValues,
  type QaStrictness,
} from '../models/app-settings.model'
import { SettingsLogModel } from '../models/settings-log.model'
import { UserSettingsModel } from '../models/user-settings.model'
import {
  MODEL_CATALOG,
  MODEL_TASKS,
  findOption,
  keyIsSet,
  optionId,
  sameProvider,
  type ModelOption,
  type ModelTask,
} from './model-catalog'
import type { SessionUser } from './auth.service'

// A bad request to the settings API; `status` is the HTTP code the route answers with.
export class SettingsInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message)
    this.name = 'SettingsInputError'
  }
}

// The saved model for a task has no API key, so the call cannot run. Never swapped for
// another model on its own: a silent switch would change cost and quality unseen.
export class ModelUnavailableError extends Error {
  constructor(task: ModelTask, option: ModelOption) {
    super(
      `The chosen model for ${MODEL_CATALOG[task].label} (${option.label}) is unavailable: ` +
        'its API key is not set. Ask an admin to choose another in Settings > Models.',
    )
    this.name = 'ModelUnavailableError'
  }
}

// The QA model comes from the same provider as report generation, so the check would not
// be independent (S-01 AC9, EV-05 AC4).
export class QaSameProviderError extends Error {
  constructor() {
    super(
      'The chosen QA model is from the same provider as report generation, so the check would ' +
        'not be independent. Ask an admin to choose another in Settings > Models.',
    )
    this.name = 'QaSameProviderError'
  }
}

const metadata = (source_type: 'settings' | 'settings_change') => ({
  source_type,
  jurisdiction: null,
  facility_type: null,
  COPE_dimension: null,
  effective_date: new Date(),
})

const PERSONAL_DEFAULTS: PersonalValues = { standardsTargetPct: 50 }

// The one admin document; created on first use so a fresh database needs no seed.
async function appSettings(): Promise<IAppSettings> {
  const doc = await AppSettingsModel.findOneAndUpdate(
    { key: 'global' },
    {
      $setOnInsert: {
        key: 'global',
        models: {},
        qaStrictness: 'standard',
        defaults: PERSONAL_DEFAULTS,
        metadata: metadata('settings'),
      },
    },
    { upsert: true, returnDocument: 'after', lean: true },
  )
  return doc as IAppSettings
}

// What a task uses now: the saved choice, else the model named in `.env`, else the recommended one.
function selectedOption(task: ModelTask, saved: IAppSettings): ModelOption {
  const { options, envDefault } = MODEL_CATALOG[task]
  return (
    findOption(task, saved.models[task] ?? '') ??
    options.find((o) => o.model === process.env[envDefault]) ??
    options.find((o) => o.recommended) ??
    options[0]
  )
}

/**
 * Returns the provider and model a task uses now, and whether an admin saved the choice.
 * Throws ModelUnavailableError when the model in use has no API key. When nothing is saved and
 * `.env` names a model the catalog does not list, that model is left alone (`saved: false`).
 */
export async function resolveModel(
  task: ModelTask,
): Promise<{ provider: string; model: string; saved: boolean }> {
  const settings = await appSettings()
  const option = selectedOption(task, settings)
  const saved = !!findOption(task, settings.models[task] ?? '')
  const envModel = process.env[MODEL_CATALOG[task].envDefault]
  const envListed = MODEL_CATALOG[task].options.some((o) => o.model === envModel)
  // A `.env` model outside the catalog is the service's own business: no key check, no override.
  if ((saved || !envModel || envListed) && !keyIsSet(option.keyEnv)) {
    throw new ModelUnavailableError(task, option)
  }
  return { provider: option.provider, model: option.model, saved }
}

/** Throws QaSameProviderError when the QA model shares a provider with drafting. EV-05 calls this before it runs. */
export async function assertQaCanRun(): Promise<void> {
  const saved = await appSettings()
  if (sameProvider(selectedOption('qa', saved), selectedOption('drafting', saved))) {
    throw new QaSameProviderError()
  }
}

function optionView(task: ModelTask, option: ModelOption, saved: IAppSettings) {
  const keySet = keyIsSet(option.keyEnv)
  const sharesDrafting = task === 'qa' && sameProvider(option, selectedOption('drafting', saved))
  return {
    id: optionId(option),
    provider: option.provider,
    model: option.model,
    label: option.label,
    recommended: !!option.recommended,
    keySet,
    // Greyed out: no key, or (QA only) the drafting provider. The second can still be chosen.
    greyed: !keySet || sharesDrafting,
    selectable: keySet,
    note: !keySet ? 'No API key' : sharesDrafting ? 'Same provider as report generation' : null,
  }
}

function rowWarning(task: ModelTask, selected: ModelOption, saved: IAppSettings): string | null {
  const label = MODEL_CATALOG[task].label
  if (!keyIsSet(selected.keyEnv)) {
    return `The chosen model (${selected.label}) cannot be used: its API key is not set in .env. ${label} will not work until an admin chooses another.`
  }
  if (task === 'qa' && sameProvider(selected, selectedOption('drafting', saved))) {
    return 'The QA model is from the same provider as report generation, so the QA check will not run. Choose a model from another provider.'
  }
  return null
}

const personalValue = (
  key: keyof PersonalValues,
  saved: IAppSettings,
  own: PersonalValues | undefined,
) => {
  const def = saved.defaults[key] ?? PERSONAL_DEFAULTS[key] ?? null
  const mine = own?.[key] ?? null
  return { value: mine ?? def, own: mine, default: def }
}

/** Returns everything the Settings screen shows for this person: models with lights, warnings, personal values. */
export async function getSettings(user: SessionUser) {
  const saved = await appSettings()
  const own = (await UserSettingsModel.findOne({ user: user.id }).lean())?.values
  return {
    canEditGlobal: user.role === 'knowledge_admin',
    models: MODEL_TASKS.map((task) => {
      const selected = selectedOption(task, saved)
      return {
        task,
        label: MODEL_CATALOG[task].label,
        fixed: !!MODEL_CATALOG[task].fixed,
        selected: optionId(selected),
        warning: rowWarning(task, selected, saved),
        options: MODEL_CATALOG[task].options.map((o) => optionView(task, o, saved)),
      }
    }),
    qaStrictness: saved.qaStrictness,
    personal: {
      standardsTargetPct: personalValue('standardsTargetPct', saved, own),
      defaultCountry: personalValue('defaultCountry', saved, own),
      defaultFacilityType: personalValue('defaultFacilityType', saved, own),
      defaultTitle: personalValue('defaultTitle', saved, own),
    },
  }
}

async function log(by: SessionUser, setting: string, before: unknown, after: unknown) {
  await SettingsLogModel.create({
    by: { id: by.id, name: by.name },
    at: new Date(),
    setting,
    before: before ?? null,
    after: after ?? null,
    metadata: metadata('settings_change'),
  })
}

/** Saves the admin's model choice for one task, after checking it; takes effect on the next call. */
export async function saveModelChoice(by: SessionUser, task: string, choice: unknown) {
  if (!(MODEL_TASKS as readonly string[]).includes(task)) {
    throw new SettingsInputError('That task does not exist.', 404)
  }
  const t = task as ModelTask
  if (MODEL_CATALOG[t].fixed) {
    throw new SettingsInputError(
      `${MODEL_CATALOG[t].label} is fixed in code and cannot be changed.`,
    )
  }
  const option = typeof choice === 'string' ? findOption(t, choice) : undefined
  if (!option) throw new SettingsInputError('That model is not on the list for this task.')
  if (!keyIsSet(option.keyEnv)) {
    throw new SettingsInputError(
      `${option.label} has no API key set in .env, so it cannot be chosen.`,
    )
  }
  const before = optionId(selectedOption(t, await appSettings()))
  await AppSettingsModel.updateOne(
    { key: 'global' },
    { $set: { [`models.${t}`]: optionId(option) } },
  )
  await log(by, `models.${t}`, before, optionId(option))
}

const text = (v: unknown) =>
  v === null || (typeof v === 'string' && v.trim().length > 0 && v.length <= 80)
const VALID: Record<keyof PersonalValues, (v: unknown) => boolean> = {
  standardsTargetPct: (v) =>
    v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100),
  defaultCountry: text,
  defaultFacilityType: text,
  defaultTitle: text,
}

// Keeps only the known personal keys; a bad value is a 400, never silently dropped.
function personalPatch(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new SettingsInputError('Nothing to save.')
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const valid = VALID[key as keyof PersonalValues]
    if (!valid) throw new SettingsInputError(`"${key}" is not a setting.`)
    if (!valid(value)) throw new SettingsInputError(`"${key}" has a value that is not allowed.`)
    patch[key] = value
  }
  if (!Object.keys(patch).length) throw new SettingsInputError('Nothing to save.')
  return patch
}

/** Saves the admin's QA strictness and default personal values for everyone, logging each change. */
export async function saveGlobal(
  by: SessionUser,
  input: { qaStrictness?: unknown; defaults?: unknown },
) {
  const saved = await appSettings()
  if (input.qaStrictness !== undefined) {
    if (!(QA_STRICTNESS as readonly unknown[]).includes(input.qaStrictness)) {
      throw new SettingsInputError('QA strictness must be strict, standard or lenient.')
    }
    await AppSettingsModel.updateOne(
      { key: 'global' },
      { $set: { qaStrictness: input.qaStrictness } },
    )
    await log(by, 'qaStrictness', saved.qaStrictness, input.qaStrictness as QaStrictness)
  }
  if (input.defaults !== undefined) {
    for (const [key, value] of Object.entries(personalPatch(input.defaults))) {
      if (value === null) throw new SettingsInputError(`A default for "${key}" cannot be empty.`)
      await AppSettingsModel.updateOne({ key: 'global' }, { $set: { [`defaults.${key}`]: value } })
      await log(by, `defaults.${key}`, saved.defaults[key as keyof PersonalValues], value)
    }
  }
}

/** Saves this person's own values; null clears one so the admin's default applies again. */
export async function savePersonal(userId: string, input: unknown) {
  const patch = personalPatch(input)
  const set: Record<string, unknown> = {}
  const unset: Record<string, ''> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) unset[`values.${key}`] = ''
    else set[`values.${key}`] = value
  }
  await UserSettingsModel.updateOne(
    { user: userId },
    {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      $setOnInsert: { user: userId, metadata: metadata('settings') },
    },
    { upsert: true },
  )
}
