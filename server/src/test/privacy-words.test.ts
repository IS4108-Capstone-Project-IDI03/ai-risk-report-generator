import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config'
import app from '../index'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { AssessmentModel } from '../models/assessment.model'
import { chatPrivacy, privacyFor } from '../services/privacy.service'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { PrivacyWordModel } from '../models/privacy-word.model'
import { seedPrivacyWords } from '../services/privacy-words.service'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// PV-09: the knowledge admin's Always masked and Never masked lists, kept in Settings and sent
// by the gateway with every masking request.
useMemoryMongo()

// Signed in each test, after the clock is set, so a session never outlives its idle limit.
let admin: ReturnType<typeof signedInAsRole>
let engineer: ReturnType<typeof signedInAsRole>

const SITE = {
  code: 'SITE-0001',
  name: 'Jurong Distribution Hub',
  address: '2 Jurong Port Road',
  jurisdiction: 'SG',
  facilityType: 'Distribution warehouse',
}

function user(name: string) {
  return {
    _id: new Types.ObjectId(),
    staffId: `TEST-${name}`,
    name,
    email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    role: 'risk_engineer' as const,
    active: true,
  }
}

// The lists are cached for a minute, as chat's known names are. Only Date is faked, so Mongo's
// own timers still run, and each test starts an hour past the last one's cache.
let now = Date.now()
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime((now += 60 * 60_000))
  admin = signedInAsRole(app, 'knowledge_admin', 'Sana')
  engineer = signedInAsRole(app, 'risk_engineer', 'Alex')
  config.piiProtection = 'required'
  allowList = { status: 200, words: DEFAULTS }
  vi.stubGlobal('fetch', vi.fn(privacyService))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  config.piiProtection = 'off'
})

// privacy-service's GET /allow-list (PV-09): the file's words the gateway seeds Never masked from.
const DEFAULTS = [{ word: 'Sprinkl', reason: 'report wording, read as a person in a past report' }]
let allowList: { status: number; words: typeof DEFAULTS }
async function privacyService(url: string | URL | Request) {
  expect(String(url)).toMatch(/\/allow-list$/)
  return new Response(JSON.stringify({ words: allowList.words }), { status: allowList.status })
}

describe('Never masked (PV-09 AC3)', () => {
  it('sends a word the admin adds with every masking request', async () => {
    const res = await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'never', word: 'Hosereel', reason: 'equipment, read as a person' })
    expect(res.status).toBe(201)

    expect((await chatPrivacy()).never_masked).toContain('Hosereel')
  })

  it.each([
    ['a client', 'JURONG PORT PTE LTD', 'Jurong Port Pte Ltd'],
    ["a client's former name", 'old  jurong port', 'Old Jurong Port'],
    ['a site', 'jurong distribution hub', 'Jurong Distribution Hub'],
    ["a site's address", '2 jurong port road', '2 Jurong Port Road'],
    ['a user', 'mei lin', 'Mei Lin'],
  ])('refuses %s, whatever its case, so masking wins (AC4)', async (_what, word, recorded) => {
    const client = await ClientModel.create({
      name: 'Jurong Port Pte Ltd',
      key: 'jurong port pte ltd',
      formerNames: ['Old Jurong Port'],
    })
    await SiteModel.create({ ...SITE, client: client._id })
    await UserModel.create(user('Mei Lin'))

    const res = await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'never', word, reason: 'test' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain(recorded)
    expect((await chatPrivacy()).never_masked).not.toContain(word)
  })

  it('refuses a word already on the list, whatever its case', async () => {
    const add = (word: string) =>
      admin.post('/api/settings/privacy-words').send({ list: 'never', word, reason: 'test' })
    await add('Hosereel')
    const res = await add('hosereel ')
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already')
  })

  it('refuses a word on Always masked (AC4)', async () => {
    await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'always', word: 'Crest Tower', kind: 'SITE', reason: 'old report' })
    const res = await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'never', word: 'crest tower', reason: 'test' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('Always masked')
  })
})

describe('Always masked (PV-09 AC1)', () => {
  it("masks the name as its kind in an assessment's and in chat's requests", async () => {
    const site = await SiteModel.create(SITE)
    await AssessmentModel.create({ reference: 'RPT-2026-0001', site: site._id, surveyType: 'PRE' })
    const res = await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'always', word: 'Crest Tower', kind: 'SITE', reason: 'named in a past report' })
    expect(res.status).toBe(201)

    const crest = { type: 'SITE', names: ['Crest Tower'] }
    expect((await privacyFor('RPT-2026-0001')).known_entities).toContainEqual(crest)
    expect((await chatPrivacy()).known_entities).toContainEqual(crest)
  })

  it('needs a kind', async () => {
    const res = await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'always', word: 'Crest Tower', reason: 'named in a past report' })
    expect(res.status).toBe(400)
  })
})

describe('reading, removing and the change log (PV-09 AC7, AC9)', () => {
  it('lists each word with who added it, and logs who, what and why', async () => {
    await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'never', word: 'Hosereel', reason: 'equipment' })

    const res = await admin.get('/api/settings/privacy-words')
    expect(res.status).toBe(200)
    expect(res.body.protectionOn).toBe(true)
    expect(res.body.always).toEqual([])
    expect(res.body.never).toContainEqual(
      expect.objectContaining({
        word: 'Hosereel',
        reason: 'equipment',
        source: 'admin',
        addedBy: expect.objectContaining({ name: 'Sana' }),
      }),
    )
    expect(res.body.history).toEqual([
      expect.objectContaining({
        by: expect.objectContaining({ name: 'Sana' }),
        before: null,
        after: { list: 'never', word: 'Hosereel', kind: null, reason: 'equipment' },
      }),
    ])
  })

  it('removes a word, logs it, and stops sending it', async () => {
    await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'never', word: 'Hosereel', reason: 'equipment' })
    const entry = (await admin.get('/api/settings/privacy-words')).body.never.find(
      (w: { word: string }) => w.word === 'Hosereel',
    )

    const res = await admin.delete(`/api/settings/privacy-words/${entry.id}`)
    expect(res.status).toBe(200)

    const after = (await admin.get('/api/settings/privacy-words')).body
    expect(after.never.map((w: { word: string }) => w.word)).not.toContain('Hosereel')
    expect(after.history[0]).toMatchObject({
      before: { list: 'never', word: 'Hosereel', kind: null, reason: 'equipment' },
      after: null,
    })
    expect((await chatPrivacy()).never_masked).not.toContain('Hosereel')
  })

  it('answers 404 for a word that is not on a list', async () => {
    const res = await admin.delete(`/api/settings/privacy-words/${new Types.ObjectId()}`)
    expect(res.status).toBe(404)
  })

  it('says when protection is off, as the lists apply only when it is on (AC9)', async () => {
    config.piiProtection = 'off'
    expect((await admin.get('/api/settings/privacy-words')).body.protectionOn).toBe(false)
  })
})

describe('the defaults that come with the app (PV-09 AC5)', () => {
  const words = async () =>
    (await admin.get('/api/settings/privacy-words')).body.never.map(
      (w: { word: string; reason: string; source: string }) => [w.word, w.reason, w.source],
    )

  it("are seeded from privacy-service's file once, each with its heading as the reason", async () => {
    expect(await words()).toEqual([
      ['Sprinkl', 'report wording, read as a person in a past report', 'default'],
    ])
    expect((await chatPrivacy()).never_masked).toEqual(['Sprinkl'])
  })

  it('stay removed once the admin removes one, after a restart too', async () => {
    const [entry] = (await admin.get('/api/settings/privacy-words')).body.never
    await admin.delete(`/api/settings/privacy-words/${entry.id}`)

    await seedPrivacyWords() // as at the next start
    expect(await words()).toEqual([])
  })

  it("leave Never masked out of requests until they are seeded, so the file's words apply", async () => {
    allowList = { status: 503, words: [] }
    expect((await chatPrivacy()).never_masked).toBeUndefined()

    // An admin can't add a word that would then be sent without the defaults.
    const res = await admin
      .post('/api/settings/privacy-words')
      .send({ list: 'never', word: 'Hosereel', reason: 'equipment' })
    expect(res.status).toBe(503)
    expect(res.body.error).toContain('default Never masked words')
    expect(res.body.error).not.toContain('shipped')
    expect((await admin.get('/api/settings/privacy-words')).status).toBe(503)
  })
})

describe('when a change is used (PV-09 AC8)', () => {
  it("is used by another gateway process's requests once the minute is up", async () => {
    expect((await chatPrivacy()).never_masked).toEqual(['Sprinkl'])
    // Added through another process: this one's cache doesn't know.
    await PrivacyWordModel.create({
      list: 'never',
      word: 'Hosereel',
      key: 'hosereel',
      reason: 'equipment',
      source: 'admin',
      addedBy: null,
      at: new Date(),
      metadata: { source_type: 'settings', effective_date: new Date() },
    })

    vi.setSystemTime((now += 30_000))
    expect((await chatPrivacy()).never_masked).not.toContain('Hosereel')
    vi.setSystemTime((now += 31_000))
    expect((await chatPrivacy()).never_masked).toContain('Hosereel')
  })
})

describe('Masked in reports (PV-09 AC10)', () => {
  it('lists each masked word once, with its kind and how many reports hold it, and nothing else', async () => {
    await KnowledgeDocumentModel.collection.insertMany([
      {
        title: 'Crest Mall 2024',
        privacyMapping: { '[PERSON_1]': 'Sprinkl', '[PERSON_2]': 'Mei Lin' },
      },
      {
        title: 'Lindenmoor 2023',
        privacyMapping: { '[PERSON_4]': 'sprinkl', '[PHONE_1]': '+65 9123 4567' },
      },
      { title: 'NFPA 13', privacyMapping: null },
    ])

    const res = await admin.get('/api/settings/privacy-words/masked-in-reports')
    expect(res.status).toBe(200)
    expect(res.body.words).toEqual(
      expect.arrayContaining([
        { word: 'Sprinkl', kind: 'PERSON', reports: 2, neverMasked: true },
        { word: 'Mei Lin', kind: 'PERSON', reports: 1, neverMasked: false },
        { word: '+65 9123 4567', kind: 'PHONE', reports: 1, neverMasked: false },
      ]),
    )
    expect(res.body.words).toHaveLength(3)
    // Never a tag or which report: the mapping itself stays out of the browser.
    const sent = JSON.stringify(res.body)
    for (const hidden of ['[PERSON_1]', 'PERSON_4', 'Crest Mall', 'Lindenmoor', '_id']) {
      expect(sent).not.toContain(hidden)
    }
  })

  it('is refused to an engineer', async () => {
    expect((await engineer.get('/api/settings/privacy-words/masked-in-reports')).status).toBe(403)
  })
})

describe('who may see and change the lists (PV-09 AC6)', () => {
  it('refuses an engineer on every route', async () => {
    const id = new Types.ObjectId()
    const answers = await Promise.all([
      engineer.get('/api/settings/privacy-words'),
      engineer
        .post('/api/settings/privacy-words')
        .send({ list: 'never', word: 'Hosereel', reason: 'test' }),
      engineer.delete(`/api/settings/privacy-words/${id}`),
    ])
    expect(answers.map((r) => r.status)).toEqual([403, 403, 403])
  })
})
