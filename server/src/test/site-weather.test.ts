// CP-62: the weather at an assessment's site, through GET /api/assessments/:reference/weather,
// with Google's Geocoding and Weather APIs stubbed.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import app from '../index'
import { config } from '../config'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { forgetSiteWeather, judge } from '../services/site-weather.service'
import type { ProviderReading } from '../services/weather-provider'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'
import { oneAssessment } from './new-assessments'

useMemoryMongo()

const alex = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'test-1@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, alex)

const KEY = 'server-test-key'
const JURONG = {
  name: 'Jurong Distribution Hub',
  address: '2 Jurong Port Road',
  jurisdiction: 'SG',
  facilityType: 'Distribution warehouse',
}
const FOUND = { lat: 1.3071, lng: 103.7202 }
const PIN = { lat: 1.2966, lng: 103.852 }

// What the stubbed Google answers: change these in a test.
type Now = { type: string; text: string; mm: number; temp: number }
let geocoder: { status: number; body: unknown } | 'unreachable'
let now: Now
let hours: { chance: number; mm: number; type?: string; thunder?: number }[]
let weatherDown: number | 'unreachable' | null
const calls = { geocode: 0, current: 0, hours: 0 }
const urls: URL[] = []

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const HOUR = 60 * 60_000
// The start of the current hour, as Google's hourly forecast starts.
const hourStart = () => Math.floor(Date.now() / HOUR) * HOUR

// Google, and nothing else: the services' closed ports stay closed, so MarshBot's re-check after
// a create (which reads rag-service) neither reaches this nor counts in it.
async function google(input: string | URL | Request) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!url.hostname.endsWith('googleapis.com')) throw new TypeError('fetch failed')
  urls.push(url)
  if (url.pathname.endsWith('/geocode/json')) {
    calls.geocode++
    if (geocoder === 'unreachable') throw new TypeError('fetch failed')
    return json(geocoder.status, geocoder.body)
  }
  const isHours = url.pathname.includes('forecast/hours')
  calls[isHours ? 'hours' : 'current']++
  if (weatherDown === 'unreachable') throw new TypeError('fetch failed')
  if (weatherDown) return json(weatherDown, { error: { message: 'down' } })
  if (isHours)
    return json(200, {
      forecastHours: hours.map((h, i) => ({
        interval: {
          startTime: new Date(hourStart() + i * HOUR).toISOString(),
          endTime: new Date(hourStart() + (i + 1) * HOUR).toISOString(),
        },
        weatherCondition: { type: h.type ?? 'CLOUDY', description: { text: 'Cloudy' } },
        precipitation: {
          probability: { percent: h.chance, type: 'RAIN' },
          qpf: { quantity: h.mm, unit: 'MILLIMETERS' },
        },
        thunderstormProbability: h.thunder ?? 0,
      })),
      timeZone: { id: 'Asia/Singapore' },
    })
  return json(200, {
    currentTime: new Date().toISOString(),
    timeZone: { id: 'Asia/Singapore' },
    weatherCondition: { type: now.type, description: { text: now.text, languageCode: 'en' } },
    temperature: { degrees: now.temp, unit: 'CELSIUS' },
    precipitation: {
      probability: { percent: 0, type: 'RAIN' },
      qpf: { quantity: now.mm, unit: 'MILLIMETERS' },
    },
    thunderstormProbability: 0,
  })
}

const geocoded = (point = FOUND, types = ['street_address']) => ({
  status: 200,
  body: { status: 'OK', results: [{ types, geometry: { location: point } }] },
})

// Only Date is faked, so Mongo's own timers still run; each test starts an hour past the last.
let clock = Date.now()
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime((clock += 24 * HOUR))
  await UserModel.create(alex)
  forgetSiteWeather()
  config.weather.key = KEY
  config.weather.rainingMmPerHour = 0.5
  config.weather.rainExpectedPercent = 50
  geocoder = geocoded()
  now = { type: 'CLOUDY', text: 'Cloudy', mm: 0, temp: 29.4 }
  hours = [
    { chance: 10, mm: 0 },
    { chance: 20, mm: 0 },
    { chance: 30, mm: 0 },
  ]
  weatherDown = null
  calls.geocode = calls.current = calls.hours = 0
  urls.length = 0
  vi.stubGlobal('fetch', vi.fn(google))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  config.weather.key = undefined
})

async function visit(site: Record<string, unknown> = JURONG) {
  const res = await api
    .post('/api/assessments')
    .send(oneAssessment({ client: 'Jurong Port', site, siteVisitDate: '2026-11-23' }))
  expect(res.status).toBe(201)
  const a = res.body.assessments[0]
  return { reference: a.reference as string, siteId: a.site.id as string }
}
const weather = (reference: string) => api.get(`/api/assessments/${reference}/weather`)

describe('the site is found from its address (AC1)', () => {
  it('geocodes the address once and keeps its latitude and longitude on the site', async () => {
    const { reference, siteId } = await visit()
    const res = await weather(reference)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.reading.located).toBe('address')
    const site = await SiteModel.findById(siteId).lean()
    expect(site?.geocode).toMatchObject({ address: JURONG.address, found: true, ...FOUND })
    const asked = urls.find((u) => u.pathname.endsWith('/geocode/json'))!
    expect(asked.searchParams.get('address')).toBe(JURONG.address)
    expect(asked.searchParams.get('region')).toBe('sg')
    const current = urls.find((u) => u.pathname.includes('currentConditions'))!
    expect(current.searchParams.get('location.latitude')).toBe(String(FOUND.lat))

    forgetSiteWeather()
    await weather(reference)
    expect(calls.geocode).toBe(1)
  })

  it('says to add the address when the site has none, and guesses nothing', async () => {
    const { reference, siteId } = await visit()
    await SiteModel.updateOne({ _id: siteId }, { $unset: { address: 1 } })
    const res = await weather(reference)
    expect(res.body).toEqual({ status: 'no-address', address: null })
    expect(urls).toEqual([])
  })

  it.each([
    ['no place', { status: 200, body: { status: 'ZERO_RESULTS', results: [] } }],
    ['only the country', geocoded({ lat: 1.35, lng: 103.82 }, ['country', 'political'])],
  ])('says the same when the geocoder finds %s, and does not ask again', async (_, answer) => {
    geocoder = answer
    const { reference, siteId } = await visit()
    const res = await weather(reference)
    expect(res.body).toEqual({ status: 'no-address', address: JURONG.address })
    expect(calls.current).toBe(0)
    expect((await SiteModel.findById(siteId).lean())?.geocode).toMatchObject({ found: false })
    await weather(reference)
    expect(calls.geocode).toBe(1)
  })

  it('looks a corrected address up again', async () => {
    const { reference, siteId } = await visit()
    await weather(reference)
    const moved = { lat: 1.33, lng: 103.74 }
    geocoder = geocoded(moved)
    const put = await api.put(`/api/sites/${siteId}`).send({ ...JURONG, address: '9 Pandan Road' })
    expect(put.status).toBe(204)
    forgetSiteWeather()
    await weather(reference)
    expect(calls.geocode).toBe(2)
    expect((await SiteModel.findById(siteId).lean())?.geocode).toMatchObject({
      address: '9 Pandan Road',
      ...moved,
    })
  })

  it("uses the engineer's pin on the site map before the address", async () => {
    const { reference } = await visit({ ...JURONG, coordinates: PIN })
    const res = await weather(reference)
    expect(res.body.reading.located).toBe('pin')
    expect(calls.geocode).toBe(0)
    const current = urls.find((u) => u.pathname.includes('currentConditions'))!
    expect(current.searchParams.get('location.longitude')).toBe(String(PIN.lng))
  })

  it("says weather is unavailable, not that the address is missing, when the geocoder can't be reached", async () => {
    geocoder = 'unreachable'
    const { reference } = await visit()
    const res = await weather(reference)
    expect(res.body).toMatchObject({ status: 'unavailable', lastReadingAt: null })
    // Not asked again within 30 seconds; asked once that has passed.
    await weather(reference)
    expect(calls.geocode).toBe(1)
    vi.setSystemTime(Date.now() + 31_000)
    geocoder = geocoded()
    expect((await weather(reference)).body.status).toBe('ok')
  })
})

describe('the conditions now and the next 2 hours (AC2, AC3)', () => {
  it('gives rain or no rain, rainfall, temperature, the forecast and the site time zone', async () => {
    const { reference } = await visit()
    const { body } = await weather(reference)
    expect(body.source).toEqual({ name: 'Google Weather', url: expect.any(String) })
    expect(body.reading).toMatchObject({
      condition: 'Cloudy',
      raining: false,
      thunder: false,
      rainfallMmPerHour: 0,
      temperatureC: 29.4,
      timeZone: 'Asia/Singapore',
      forecast: { rainExpected: false, thunderExpected: false },
    })
    // The current hour, which has begun, and the next two: three hours overlap the next 2 hours.
    expect(body.reading.forecast.hours).toHaveLength(3)
    expect(body.reading.forecast.hours[1]).toMatchObject({ chancePercent: 20, rain: false })
  })

  it.each([
    ['a rain condition', { type: 'LIGHT_RAIN', text: 'Light rain', mm: 0.2 }, true, false],
    ['rainfall at the threshold', { type: 'CLOUDY', text: 'Cloudy', mm: 0.5 }, true, false],
    ['rainfall under it', { type: 'CLOUDY', text: 'Cloudy', mm: 0.4 }, false, false],
    ['a chance of showers', { type: 'CHANCE_OF_SHOWERS', text: 'Chance', mm: 0 }, false, false],
    ['a thunderstorm', { type: 'SCATTERED_THUNDERSTORMS', text: 'Storms', mm: 3 }, true, true],
    ['a thundershower', { type: 'THUNDERSHOWER', text: 'Thundershower', mm: 1 }, true, true],
  ])('judges %s', async (_, condition, raining, thunder) => {
    now = { ...now, ...condition }
    const { reference } = await visit()
    const { body } = await weather(reference)
    expect(body.reading).toMatchObject({ raining, thunder })
  })

  it('expects rain when an hour of the next 2 reaches the chance, or the rate, in config', async () => {
    const { reference } = await visit()
    hours = [
      { chance: 10, mm: 0 },
      { chance: 60, mm: 0 },
      { chance: 0, mm: 0 },
    ]
    expect((await weather(reference)).body.reading.forecast.rainExpected).toBe(true)

    forgetSiteWeather()
    hours = [
      { chance: 30, mm: 0 },
      { chance: 40, mm: 0.6 },
      { chance: 0, mm: 0 },
    ]
    expect((await weather(reference)).body.reading.forecast.rainExpected).toBe(true)

    forgetSiteWeather()
    hours = [
      { chance: 30, mm: 0 },
      { chance: 40, mm: 0.2 },
      { chance: 0, mm: 0 },
    ]
    expect((await weather(reference)).body.reading.forecast.rainExpected).toBe(false)

    forgetSiteWeather()
    config.weather.rainExpectedPercent = 30
    expect((await weather(reference)).body.reading.forecast.rainExpected).toBe(true)
  })

  it('expects thunderstorms from the condition or their chance', async () => {
    const { reference } = await visit()
    hours = [
      { chance: 10, mm: 0 },
      { chance: 20, mm: 0, thunder: 55 },
      { chance: 0, mm: 0 },
    ]
    const { body } = await weather(reference)
    expect(body.reading.forecast).toMatchObject({ rainExpected: true, thunderExpected: true })
  })

  it('leaves out an hour that starts 2 hours or more from now', () => {
    const at = new Date('2026-11-23T08:40:00Z')
    const hour = (h: number, chance: number) => ({
      from: new Date(Date.UTC(2026, 10, 23, h)),
      to: new Date(Date.UTC(2026, 10, 23, h + 1)),
      conditionType: 'CLOUDY',
      chancePercent: chance,
      rainfallMm: 0,
      thunderPercent: 0,
    })
    const reading: ProviderReading = {
      observedAt: at,
      timeZone: 'Asia/Singapore',
      conditionType: 'CLEAR',
      conditionText: 'Clear',
      rainfallMm: 0,
      temperatureC: 30,
      hours: [hour(7, 90), hour(8, 0), hour(9, 0), hour(10, 0), hour(11, 90)],
    }
    const judged = judge(reading, 'address', at)
    expect(judged.forecast.hours.map((h) => h.from)).toEqual([
      '2026-11-23T08:00:00.000Z',
      '2026-11-23T09:00:00.000Z',
      '2026-11-23T10:00:00.000Z',
    ])
    expect(judged.forecast.rainExpected).toBe(false)
  })
})

describe('only the gateway calls the provider, at most every 10 minutes (AC5)', () => {
  it('keeps a reading for 10 minutes per site, then reads again', async () => {
    const { reference } = await visit()
    await weather(reference)
    await weather(reference)
    expect(calls).toMatchObject({ current: 1, hours: 1 })
    vi.setSystemTime(Date.now() + 9 * 60_000)
    await weather(reference)
    expect(calls.current).toBe(1)
    vi.setSystemTime(Date.now() + 2 * 60_000)
    await weather(reference)
    expect(calls).toMatchObject({ current: 2, hours: 2 })
  })

  it('shares one reading between assessments at the same site', async () => {
    const first = await visit()
    const res = await api.post('/api/assessments').send(
      oneAssessment({
        clientId: (await SiteModel.findById(first.siteId).lean())!.client!.toString(),
        siteId: first.siteId,
        surveyType: 'Resurvey',
      }),
    )
    expect(res.status).toBe(201)
    await weather(first.reference)
    await weather(res.body.assessments[0].reference)
    expect(calls.current).toBe(1)
  })

  it('sends the key only to Google, never to the browser', async () => {
    const { reference } = await visit()
    const res = await weather(reference)
    expect(JSON.stringify(res.body)).not.toContain(KEY)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((u) => u.searchParams.get('key') === KEY)).toBe(true)
  })

  it('says weather is not set up when the server has no key', async () => {
    config.weather.key = undefined
    const { reference } = await visit()
    expect((await weather(reference)).body).toEqual({ status: 'unconfigured' })
    expect(urls).toEqual([])
  })
})

describe('an unreachable provider (AC6)', () => {
  it('says unavailable with when the last good reading was taken, and no reading', async () => {
    const { reference } = await visit()
    const good = await weather(reference)
    vi.setSystemTime(Date.now() + 11 * 60_000)
    weatherDown = 503
    const res = await weather(reference)
    expect(res.body).toEqual({
      status: 'unavailable',
      lastReadingAt: good.body.reading.observedAt,
      timeZone: 'Asia/Singapore',
      source: good.body.source,
    })
  })

  it("says so with no time when there was never a reading, and doesn't ask again for 30 seconds", async () => {
    weatherDown = 'unreachable'
    const { reference } = await visit()
    expect((await weather(reference)).body).toMatchObject({
      status: 'unavailable',
      lastReadingAt: null,
    })
    await weather(reference)
    expect(calls.current).toBe(1)
    vi.setSystemTime(Date.now() + 31_000)
    weatherDown = null
    expect((await weather(reference)).body.status).toBe('ok')
  })
})

describe('who may read it', () => {
  it('needs a session', async () => {
    const { reference } = await visit()
    expect((await request(app).get(`/api/assessments/${reference}/weather`)).status).toBe(401)
  })

  it('is open to a knowledge admin, who can view every assessment', async () => {
    const { reference } = await visit()
    const admin = signedInAsRole(app, 'knowledge_admin', 'Sana')
    expect((await admin.get(`/api/assessments/${reference}/weather`)).status).toBe(200)
  })

  it('answers 404 for an unknown assessment', async () => {
    expect((await weather('RPT-2026-9999')).status).toBe(404)
  })
})
