import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../index'
import { SettingsLogModel } from '../models/settings-log.model'
import { ModelUnavailableError, resolveModel } from '../services/settings.service'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// S-01: the Settings API. Keys are fake values set on process.env; nothing is paid for.
useMemoryMongo()

const admin = signedInAsRole(app, 'knowledge_admin', 'Sana')
const engineer = signedInAsRole(app, 'risk_engineer', 'Alex')
const KEYS = {
  ANTHROPIC_API_KEY: 'sk-ant-SECRET-1',
  GEMINI_API_KEY: 'AIza-SECRET-2',
  OPENAI_API_KEY: 'sk-SECRET-3',
  OPENAI_CHAT_API_KEY: 'sk-SECRET-4',
  OPENAI_LABEL_API_KEY: 'REPLACE_ME',
  TYPESAFE_API_KEY: 'ts-SECRET-5',
} as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const [name, value] of Object.entries(KEYS)) {
    saved[name] = process.env[name]
    process.env[name] = value
  }
  for (const name of ['LLM_MODEL', 'QA_MODEL']) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
})
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

type Row = { task: string; selected: string; warning: string | null; options: Option[] }
type Option = { id: string; keySet: boolean; greyed: boolean; selectable: boolean }
const row = (body: { models: Row[] }, task: string) => body.models.find((m) => m.task === task)!
const option = (r: Row, id: string) => r.options.find((o) => o.id === id)!

describe('reading the settings (S-01 AC1, AC3, AC4, AC10)', () => {
  it('shows every task to an engineer, with a light per option and no key value', async () => {
    const res = await engineer.get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.canEditGlobal).toBe(false)
    expect(res.body.models.map((m: Row) => m.task)).toContain('transcription')
    const photo = row(res.body, 'photo')
    expect(option(photo, 'gemini:gemini-3.8-flash')).toMatchObject({ keySet: true, greyed: false })
    // A key still set to REPLACE_ME is not a key.
    const labels = row(res.body, 'label_classifier')
    expect(option(labels, 'openai:gpt-6-luna')).toMatchObject({ keySet: false, greyed: true })
    for (const secret of Object.values(KEYS)) expect(JSON.stringify(res.body)).not.toContain(secret)
  })

  it('marks the recommended option and starts from the recommended one', async () => {
    const res = await admin.get('/api/settings')
    expect(res.body.canEditGlobal).toBe(true)
    const drafting = row(res.body, 'drafting')
    expect(drafting.selected).toBe('anthropic:claude-opus-5-5')
    expect(
      drafting.options.find((o: Option & { recommended?: boolean }) => o.recommended)?.id,
    ).toBe('anthropic:claude-opus-5-5')
  })

  it('uses the model named in .env when nothing is saved', async () => {
    process.env.LLM_MODEL = 'claude-sonnet-5-5'
    const res = await admin.get('/api/settings')
    expect(row(res.body, 'drafting').selected).toBe('anthropic:claude-sonnet-5-5')
  })
})

describe('choosing a model (S-01 AC3, AC4, AC6, AC7, AC14, AC15)', () => {
  it('lets only the admin choose (403 for an engineer)', async () => {
    const res = await engineer
      .put('/api/settings/models/drafting')
      .send({ option: 'anthropic:claude-sonnet-5-5' })
    expect(res.status).toBe(403)
  })

  it('saves a choice that has a key, and the next call uses it at once', async () => {
    const res = await admin
      .put('/api/settings/models/drafting')
      .send({ option: 'anthropic:claude-sonnet-5-5' })
    expect(res.status).toBe(200)
    expect(row((await engineer.get('/api/settings')).body, 'drafting').selected).toBe(
      'anthropic:claude-sonnet-5-5',
    )
    expect(await resolveModel('drafting')).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    })
  })

  it('refuses an option whose key is not set', async () => {
    const res = await admin
      .put('/api/settings/models/label_classifier')
      .send({ option: 'openai:gpt-6-luna' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/key/i)
  })

  it('refuses an unknown option, an unknown task, and the fixed Whisper row', async () => {
    expect((await admin.put('/api/settings/models/drafting').send({ option: 'x:y' })).status).toBe(
      400,
    )
    expect((await admin.put('/api/settings/models/nope').send({ option: 'x:y' })).status).toBe(404)
    const whisper = await admin
      .put('/api/settings/models/transcription')
      .send({ option: 'openai:whisper-1' })
    expect(whisper.status).toBe(400)
  })

  it('records who changed it, when, and before and after', async () => {
    await admin.put('/api/settings/models/drafting').send({ option: 'anthropic:claude-sonnet-5-5' })
    const entries = await SettingsLogModel.find({}).lean()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      setting: 'models.drafting',
      before: 'anthropic:claude-opus-5-5',
      after: 'anthropic:claude-sonnet-5-5',
      by: { name: 'Sana' },
    })
  })

  it('cannot edit or delete a log entry', async () => {
    await admin.put('/api/settings/models/drafting').send({ option: 'anthropic:claude-sonnet-5-5' })
    await expect(SettingsLogModel.updateOne({}, { setting: 'x' })).rejects.toThrow(/append-only/)
    await expect(SettingsLogModel.deleteMany({})).rejects.toThrow(/append-only/)
  })
})

describe('a saved choice that has lost its key (S-01 AC5)', () => {
  it('warns on the row, and the call says it is unavailable instead of switching model', async () => {
    await admin.put('/api/settings/models/photo').send({ option: 'gemini:gemini-3.8-flash' })
    delete process.env.GEMINI_API_KEY
    const body = (await engineer.get('/api/settings')).body
    expect(row(body, 'photo').warning).toMatch(/cannot be used/i)
    await expect(resolveModel('photo')).rejects.toBeInstanceOf(ModelUnavailableError)
    await expect(resolveModel('photo')).rejects.toThrow(
      /chosen model for Photo reading .*unavailable.*Settings > Models/i,
    )
  })
})

describe('the QA model (S-01 AC8, AC9)', () => {
  it('greys out same-provider options but still lets them be selected, with a warning', async () => {
    const before = row((await admin.get('/api/settings')).body, 'qa')
    expect(option(before, 'anthropic:claude-sonnet-5-5')).toMatchObject({
      greyed: true,
      selectable: true,
    })
    expect(option(before, 'openai:gpt-6.1-sol')).toMatchObject({ greyed: false })
    const res = await admin
      .put('/api/settings/models/qa')
      .send({ option: 'anthropic:claude-sonnet-5-5' })
    expect(res.status).toBe(200)
    const after = row((await admin.get('/api/settings')).body, 'qa')
    expect(after.warning).toMatch(/same provider/i)
  })

  it('does not run the QA check when its provider is the drafting provider', async () => {
    await admin.put('/api/settings/models/qa').send({ option: 'anthropic:claude-sonnet-5-5' })
    const res = await engineer.post('/api/qa/check').send({})
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/same provider as report generation/i)
  })

  it('reaches the stub when the providers differ (EV-05 builds the check)', async () => {
    await admin.put('/api/settings/models/qa').send({ option: 'openai:gpt-6.1-sol' })
    const res = await engineer.post('/api/qa/check').send({})
    expect(res.status).toBe(501)
  })
})

describe('personal settings and defaults (S-01 AC11, AC12, AC14)', () => {
  it('an engineer sets their own value, others keep the admin default', async () => {
    await engineer.patch('/api/settings/me').send({ standardsTargetPct: 70 })
    const mine = (await engineer.get('/api/settings')).body.personal.standardsTargetPct
    expect(mine).toMatchObject({ value: 70, own: 70, default: 50 })
    const other = signedInAsRole(app, 'risk_engineer', 'Jide')
    expect((await other.get('/api/settings')).body.personal.standardsTargetPct.value).toBe(50)
  })

  it('an admin default reaches engineers who have not set their own, and resets', async () => {
    expect(
      (await admin.patch('/api/settings/global').send({ defaults: { standardsTargetPct: 40 } }))
        .status,
    ).toBe(200)
    expect((await engineer.get('/api/settings')).body.personal.standardsTargetPct.value).toBe(40)
    await engineer.patch('/api/settings/me').send({ standardsTargetPct: 70 })
    await engineer.patch('/api/settings/me').send({ standardsTargetPct: null })
    expect((await engineer.get('/api/settings')).body.personal.standardsTargetPct.value).toBe(40)
  })

  it('refuses an engineer on global settings and a bad value for anyone', async () => {
    expect(
      (await engineer.patch('/api/settings/global').send({ qaStrictness: 'strict' })).status,
    ).toBe(403)
    expect((await admin.patch('/api/settings/global').send({ qaStrictness: 'harsh' })).status).toBe(
      400,
    )
    expect(
      (await engineer.patch('/api/settings/me').send({ standardsTargetPct: 140 })).status,
    ).toBe(400)
  })

  it('lets the admin set the QA strictness for everyone, and logs it', async () => {
    await admin.patch('/api/settings/global').send({ qaStrictness: 'strict' })
    expect((await engineer.get('/api/settings')).body.qaStrictness).toBe('strict')
    expect((await SettingsLogModel.find({}).lean()).map((e) => e.setting)).toContain('qaStrictness')
  })
})
