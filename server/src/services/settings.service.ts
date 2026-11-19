// S-01: reads and saves the Settings (models, QA strictness) and tells
// the AI calls which model to use. Called by routes/settings.routes.ts and
// qa.service.ts; the AI-calling services ask `resolveModel`. Never returns an API key,
// only whether one is set.
import {
  AppSettingsModel,
  QA_STRICTNESS,
  type IAppSettings,
  type QaStrictness,
} from '../models/app-settings.model'
import { SettingsLogModel } from '../models/settings-log.model'
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
import { hasPermission } from './permissions.service'
import { DEFAULT_TIER_ORDER, TIER_IDS, type TierId } from './source-tiers'

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

// The one admin document; created on first use so a fresh database needs no seed.
async function appSettings(): Promise<IAppSettings> {
  try {
    return await upsertAppSettings()
  } catch (error) {
    // Two first requests at once: the loser hits the unique key (E11000); the document now exists.
    if ((error as { code?: number }).code !== 11000) throw error
    return upsertAppSettings()
  }
}

async function upsertAppSettings(): Promise<IAppSettings> {
  const doc = await AppSettingsModel.findOneAndUpdate(
    { key: 'global' },
    {
      $setOnInsert: {
        key: 'global',
        models: {},
        qaStrictness: 'standard',
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

/** Returns everything the Settings screen shows for this person: models with lights, warnings, QA strictness. */
export async function getSettings(user: SessionUser) {
  const saved = await appSettings()
  return {
    canEditGlobal: hasPermission(user.role, 'settings:manage'),
    models: MODEL_TASKS.map((task) => {
      const selected = selectedOption(task, saved)
      return {
        task,
        label: MODEL_CATALOG[task].label,
        fixed: !!MODEL_CATALOG[task].fixed,
        inUse: !MODEL_CATALOG[task].notWiredYet,
        selected: optionId(selected),
        warning: rowWarning(task, selected, saved),
        options: MODEL_CATALOG[task].options.map((o) => optionView(task, o, saved)),
      }
    }),
    qaStrictness: saved.qaStrictness,
    sourcePriority: { order: await getSourcePriority(), history: await sourcePriorityHistory() },
  }
}

/** Returns the saved tier order, highest authority first; the default when none was saved (RT-04). */
export async function getSourcePriority(): Promise<TierId[]> {
  const saved = await appSettings()
  return [...(saved.sourcePriority?.length ? saved.sourcePriority : DEFAULT_TIER_ORDER)]
}

// The last 20 order changes, newest first, read from the append-only log.
async function sourcePriorityHistory() {
  const rows = await SettingsLogModel.find({ setting: 'sourcePriority' })
    .sort({ at: -1 })
    .limit(20)
    .lean()
  return rows.map((r) => ({
    at: r.at,
    by: r.by,
    before: r.before as TierId[],
    after: r.after as TierId[],
  }))
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
  await appSettings() // makes sure the one admin document exists
  // The document as it was just before this write, so the log's "before" is right even when
  // two admins save at once.
  const previous = await AppSettingsModel.findOneAndUpdate(
    { key: 'global' },
    { $set: { [`models.${t}`]: optionId(option) } },
    { returnDocument: 'before', lean: true },
  )
  // What was really saved before, else the `.env` value in force (never a guessed default).
  const savedBefore = (previous as IAppSettings).models?.[t]
  const envValue = process.env[MODEL_CATALOG[t].envDefault]
  const before = savedBefore ?? (envValue ? `(.env) ${envValue}` : '(default)')
  if (savedBefore !== optionId(option)) await log(by, `models.${t}`, before, optionId(option))
}

/** Saves the admin's QA strictness for everyone and logs a real change. Checks it first, so a bad value saves nothing. */
export async function saveGlobal(by: SessionUser, input: unknown) {
  const body = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const unknown = Object.keys(body).filter((k) => k !== 'qaStrictness')
  if (unknown.length) throw new SettingsInputError(`"${unknown[0]}" is not a setting.`)
  if (body.qaStrictness === undefined) throw new SettingsInputError('Nothing to save.')
  if (!(QA_STRICTNESS as readonly unknown[]).includes(body.qaStrictness)) {
    throw new SettingsInputError('QA strictness must be strict, standard or lenient.')
  }
  const saved = await appSettings()
  if (body.qaStrictness === saved.qaStrictness) return
  await AppSettingsModel.updateOne({ key: 'global' }, { $set: { qaStrictness: body.qaStrictness } })
  await log(by, 'qaStrictness', saved.qaStrictness, body.qaStrictness as QaStrictness)
}

/** Saves the admin's tier order (RT-04) and logs a real change. Throws SettingsInputError unless `order` is each tier exactly once. */
export async function saveSourcePriority(by: SessionUser, order: unknown) {
  const valid =
    Array.isArray(order) &&
    order.length === TIER_IDS.length &&
    TIER_IDS.every((id) => order.includes(id))
  if (!valid) throw new SettingsInputError('The order must list each of the four tiers once.')
  const before = await getSourcePriority()
  const after = order as TierId[]
  if (before.join() === after.join()) return
  await AppSettingsModel.updateOne({ key: 'global' }, { $set: { sourcePriority: after } })
  await log(by, 'sourcePriority', before, after)
}
