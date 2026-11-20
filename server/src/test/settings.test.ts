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
      before: '(default)',
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

describe('QA strictness (S-01 AC12, AC14)', () => {
  it('refuses an engineer, and a bad value from an admin', async () => {
    expect(
      (await engineer.patch('/api/settings/global').send({ qaStrictness: 'strict' })).status,
    ).toBe(403)
    expect((await admin.patch('/api/settings/global').send({ qaStrictness: 'harsh' })).status).toBe(
      400,
    )
  })

  it('lets the admin set the QA strictness for everyone, and logs it', async () => {
    await admin.patch('/api/settings/global').send({ qaStrictness: 'strict' })
    expect((await engineer.get('/api/settings')).body.qaStrictness).toBe('strict')
    expect((await SettingsLogModel.find({}).lean()).map((e) => e.setting)).toContain('qaStrictness')
  })

  it("has no admin-set personal defaults (CP-35 brings back only the engineer's own note settings)", async () => {
    expect((await admin.get('/api/settings')).body.personal).toBeUndefined()
    expect((await engineer.patch('/api/settings/me').send({ x: 1 })).status).toBe(400)
  })
})

describe('standards cite target (GN-16)', () => {
  const patch = (body: object) => admin.patch('/api/settings/global').send(body)
  const logged = () => SettingsLogModel.find({ setting: 'standardCiteTarget' }).lean()

  it('starts at 50 and leaves the other settings alone', async () => {
    const body = (await engineer.get('/api/settings')).body
    expect(body.standardCiteTarget).toBe(50)
    expect(body.qaStrictness).toBe('standard')
  })

  it('lets the admin save 60, returns it and logs the real before', async () => {
    expect((await patch({ standardCiteTarget: 60 })).status).toBe(200)
    expect((await engineer.get('/api/settings')).body.standardCiteTarget).toBe(60)
    expect((await engineer.get('/api/settings')).body.qaStrictness).toBe('standard')
    await patch({ standardCiteTarget: 0 })
    const rows = await logged()
    expect(rows.map((r) => [r.before, r.after])).toEqual([
      [50, 60],
      [60, 0],
    ])
    expect(rows[0].by.name).toBe('Sana')
  })

  it('saves it together with the QA strictness', async () => {
    await patch({ qaStrictness: 'strict', standardCiteTarget: 100 })
    const body = (await admin.get('/api/settings')).body
    expect([body.qaStrictness, body.standardCiteTarget]).toEqual(['strict', 100])
  })

  it.each([-1, 101, 55.5, '60', null, true, [60], Number.NaN])('refuses %j', async (value) => {
    const res = await patch({ standardCiteTarget: value })
    expect(res.status).toBe(400)
    expect(res.body.error ?? res.body.message).toBe(
      'The target must be a whole number from 0 to 100.',
    )
    expect((await admin.get('/api/settings')).body.standardCiteTarget).toBe(50)
  })

  it('saves nothing when the QA strictness beside it is invalid', async () => {
    expect((await patch({ standardCiteTarget: 70, qaStrictness: 'nope' })).status).toBe(400)
    expect((await admin.get('/api/settings')).body.standardCiteTarget).toBe(50)
    expect(await SettingsLogModel.countDocuments()).toBe(0)
  })

  it('answers 403 to an engineer', async () => {
    const res = await engineer.patch('/api/settings/global').send({ standardCiteTarget: 70 })
    expect(res.status).toBe(403)
  })

  it('writes no log row when the target does not change', async () => {
    await patch({ standardCiteTarget: 50 })
    await patch({ standardCiteTarget: 60 })
    await patch({ standardCiteTarget: 60 })
    expect(await logged()).toHaveLength(1)
  })
})

describe('a .env model the catalog does not list (S-01 AC6)', () => {
  it('is left alone: no model is forced on the service until an admin saves a choice', async () => {
    process.env.LLM_MODEL = 'some-custom-model'
    const { modelHeaders } = await import('../services/model-resolver.service')
    expect(await modelHeaders('drafting')).toEqual({})
    await admin.put('/api/settings/models/drafting').send({ option: 'anthropic:claude-sonnet-5-5' })
    expect(await modelHeaders('drafting')).toEqual({ 'X-Model': 'claude-sonnet-5-5' })
  })
})

describe('hostile and sloppy input (S-01 break-it findings)', () => {
  const raw = (who: typeof admin, method: 'patch', url: string, body: string) =>
    who[method](url).set('Content-Type', 'application/json').send(body)

  it('answers 400, never 500, for __proto__ and built-in names as setting keys', async () => {
    expect(
      (await raw(admin, 'patch', '/api/settings/global', '{"__proto__":{"x":1}}')).status,
    ).toBe(400)
    expect((await admin.patch('/api/settings/global').send({ constructor: 1 })).status).toBe(400)
    expect(await SettingsLogModel.countDocuments()).toBe(0)
  })

  it('refuses an unknown top-level key or an empty body on global settings', async () => {
    expect((await admin.patch('/api/settings/global').send({ nope: 1 })).status).toBe(400)
    expect((await admin.patch('/api/settings/global').send({})).status).toBe(400)
  })

  it('writes no log row when a choice does not change', async () => {
    await admin.put('/api/settings/models/drafting').send({ option: 'anthropic:claude-sonnet-5-5' })
    const afterFirst = await SettingsLogModel.countDocuments()
    await admin.put('/api/settings/models/drafting').send({ option: 'anthropic:claude-sonnet-5-5' })
    await admin.patch('/api/settings/global').send({ qaStrictness: 'standard' })
    expect(await SettingsLogModel.countDocuments()).toBe(afterFirst)
  })

  it('logs the real before value: the .env model when nothing was saved yet', async () => {
    process.env.LLM_MODEL = 'some-custom-model'
    await admin.put('/api/settings/models/drafting').send({ option: 'anthropic:claude-opus-5-5' })
    const [entry] = await SettingsLogModel.find({}).lean()
    expect(entry.before).toBe('(.env) some-custom-model')
    expect(entry.after).toBe('anthropic:claude-opus-5-5')
  })

  it('saves nothing when the QA strictness is invalid', async () => {
    const res = await admin.patch('/api/settings/global').send({ qaStrictness: 'nope' })
    expect(res.status).toBe(400)
    expect((await admin.get('/api/settings')).body.qaStrictness).toBe('standard')
    expect(await SettingsLogModel.countDocuments()).toBe(0)
  })

  it('says which tasks nothing reads yet, so the screen can say so', async () => {
    const body = (await admin.get('/api/settings')).body
    const inUse = Object.fromEntries(
      body.models.map((m: { task: string; inUse: boolean }) => [m.task, m.inUse]),
    )
    expect(inUse).toMatchObject({
      drafting: true,
      photo: true,
      handwriting: true,
      ocr: false,
      label_classifier: false,
      site_walk_classifier: false,
      // Nothing reads the QA model until EV-05 is built.
      qa: false,
    })
  })
})

// RT-04: the order sources are ranked by.
describe('source priority (RT-04)', () => {
  const DEFAULT = [
    'national_code',
    'manufacturer_rating',
    'marsh_precedent',
    'international_standard',
  ]
  const NEW = [...DEFAULT].reverse()
  const put = (who: typeof admin, order: unknown) =>
    who.put('/api/settings/source-priority').send({ order })

  it('starts as the default order with no history', async () => {
    const res = await engineer.get('/api/settings')
    expect(res.body.sourcePriority).toEqual({ order: DEFAULT, history: [] })
  })

  it('saves a new order and logs who changed it, with before and after', async () => {
    const res = await put(admin, NEW)
    expect(res.status).toBe(200)
    expect(res.body.sourcePriority.order).toEqual(NEW)
    expect(res.body.sourcePriority.history).toHaveLength(1)
    expect(res.body.sourcePriority.history[0]).toMatchObject({
      by: { name: 'Sana' },
      before: DEFAULT,
      after: NEW,
    })
    expect((await engineer.get('/api/settings')).body.sourcePriority.order).toEqual(NEW)
  })

  it('lists history newest first', async () => {
    await put(admin, NEW)
    await put(admin, DEFAULT)
    const { history } = (await admin.get('/api/settings')).body.sourcePriority
    expect(history.map((h: { after: string[] }) => h.after)).toEqual([DEFAULT, NEW])
  })

  it('writes no log row when the order is unchanged', async () => {
    await put(admin, DEFAULT)
    expect(await SettingsLogModel.countDocuments({ setting: 'sourcePriority' })).toBe(0)
  })

  it.each([
    ['too short', DEFAULT.slice(1)],
    ['a repeat', [DEFAULT[0], DEFAULT[0], DEFAULT[2], DEFAULT[3]]],
    ['an unknown tier', [...DEFAULT.slice(1), 'nope']],
    ['not a list', 'national_code'],
  ])('answers 400 for an order that is %s, and saves nothing', async (_name, order) => {
    expect((await put(admin, order)).status).toBe(400)
    expect(await SettingsLogModel.countDocuments({ setting: 'sourcePriority' })).toBe(0)
  })

  it('answers 403 to an engineer', async () => {
    expect((await put(engineer, NEW)).status).toBe(403)
  })

  it('still refuses sourcePriority through the global setting route', async () => {
    expect((await admin.patch('/api/settings/global').send({ sourcePriority: NEW })).status).toBe(
      400,
    )
  })
})

describe('note-taking settings (CP-35)', () => {
  const me = signedInAsRole(app, 'risk_engineer', 'Mia')
  const other = signedInAsRole(app, 'risk_engineer', 'Ben')
  const save = (body: unknown) => me.patch('/api/settings/me').send(body as object)

  it('starts from the default codes and an empty glossary', async () => {
    const res = await me.get('/api/settings')
    expect(res.body.noteTaking).toEqual({
      codes: { fact: 'F', info_request: 'IR', recommendation: 'REC' },
      glossary: [],
    })
  })

  it('saves my codes and glossary, trims them, and leaves another user unaffected', async () => {
    const res = await save({
      noteCodes: { fact: ' obs ' },
      glossary: [{ term: ' FE ', meaning: 'fire extinguisher' }],
    })
    expect(res.status).toBe(200)
    expect(res.body.noteTaking).toEqual({
      codes: { fact: 'obs', info_request: 'IR', recommendation: 'REC' },
      glossary: [{ term: 'FE', meaning: 'fire extinguisher' }],
    })
    expect((await other.get('/api/settings')).body.noteTaking.codes.fact).toBe('F')
  })

  it('resets to the defaults with null', async () => {
    await save({ noteCodes: { fact: 'obs' } })
    const res = await save({ noteCodes: null })
    expect(res.body.noteTaking.codes.fact).toBe('F')
  })

  it.each([
    ['a duplicate of another code', { noteCodes: { fact: 'ir' } }],
    ['an empty code', { noteCodes: { fact: '  ' } }],
    ['a 9-character code', { noteCodes: { fact: 'abcdefghi' } }],
    ['a code with bad characters', { noteCodes: { fact: 'a-b' } }],
    ['an unknown key', { other: 1 }],
    ['a __proto__ key', JSON.parse('{"__proto__": {"x": 1}}')],
    ['an unknown code kind', JSON.parse('{"noteCodes": {"constructor": "X"}}')],
    ['an empty body', {}],
    [
      'a duplicate glossary term',
      {
        glossary: [
          { term: 'A', meaning: 'x' },
          { term: 'a', meaning: 'y' },
        ],
      },
    ],
    ['a 31-character term', { glossary: [{ term: 'x'.repeat(31), meaning: 'y' }] }],
    ['a 121-character meaning', { glossary: [{ term: 'x', meaning: 'y'.repeat(121) }] }],
    [
      '201 glossary terms',
      { glossary: Array.from({ length: 201 }, (_, i) => ({ term: `t${i}`, meaning: 'm' })) },
    ],
  ])('refuses %s with 400 and saves nothing', async (_name, body) => {
    const res = await save(body)
    expect(res.status).toBe(400)
    expect(typeof res.body.error).toBe('string')
    expect((await me.get('/api/settings')).body.noteTaking.codes.fact).toBe('F')
  })
})

describe('glossary messages (CP-35)', () => {
  it('says a glossary must be a list when it is not one', async () => {
    const res = await engineer.patch('/api/settings/me').send({ glossary: { a: 1 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/must be a list/)
  })
})
