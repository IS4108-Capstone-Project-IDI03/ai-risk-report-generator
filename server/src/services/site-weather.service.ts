// The weather at an assessment's site (CP-62), for GET /api/assessments/:reference/weather:
// whether it is raining or stormy there now and whether rain is expected in the next 2 hours, so
// the engineer knows not to set off for an outdoor or below-ground inspection. Advisory only: it
// blocks nothing (AC4).
//
// Where: the engineer's own pin on the site map (CP-26) when there is one, else the site's
// address, geocoded once and kept on the site (`geocode`, AC1). With neither, or an address the
// geocoder can't find, the answer is `no-address` and nothing is guessed.
//
// The provider (weather-provider.ts) is called by the gateway alone, with the server's key, and
// at most once per site every 10 minutes: readings are kept in memory per site (AC5). A failed
// call is not repeated for 30 seconds. When the provider can't be reached the answer is
// `unavailable` with when the last good reading was taken, never an old reading as if current
// (AC6). Memory, not Mongo or Redis: one gateway runs, and a restart only costs one call per site.
import { config } from '../config'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel, type IGeocode } from '../models/site.model'
import { AssessmentNotFoundError } from './capture-session.service'
import {
  geocodeAddress,
  readWeather,
  WEATHER_SOURCE,
  WeatherProviderError,
  type Point,
  type ProviderHour,
  type ProviderReading,
} from './weather-provider'

export const WEATHER_CACHE_MS = 10 * 60_000
export const WEATHER_RETRY_MS = 30_000
// The forecast the panel shows (AC2).
export const FORECAST_MS = 2 * 60 * 60_000

export type WeatherSource = typeof WEATHER_SOURCE

export type ForecastHourDto = {
  from: string
  to: string
  chancePercent: number | null
  rainfallMm: number | null
  rain: boolean
  thunder: boolean
}

export type WeatherReadingDto = {
  // When the provider took the reading, and when the gateway fetched it (ISO, UTC).
  observedAt: string
  fetchedAt: string
  // The site's time zone, which every time on the panel is shown in (AC6).
  timeZone: string | null
  // The provider's words for it, e.g. "Light rain".
  condition: string
  raining: boolean
  thunder: boolean
  rainfallMmPerHour: number | null
  temperatureC: number | null
  forecast: { hours: ForecastHourDto[]; rainExpected: boolean; thunderExpected: boolean }
  // Where the reading is for: the engineer's pin, or the site's address.
  located: 'pin' | 'address'
}

export type SiteWeatherDto =
  // No address and no pin, or `address` the geocoder couldn't find (AC1).
  | { status: 'no-address'; address: string | null }
  // The server has no weather key.
  | { status: 'unconfigured' }
  | {
      status: 'unavailable'
      lastReadingAt: string | null
      timeZone: string | null
      source: WeatherSource
    }
  | { status: 'ok'; reading: WeatherReadingDto; source: WeatherSource }

// ----- What counts as rain and storms (AC3) -----

// The provider's conditions with rain falling now. CHANCE_OF_SHOWERS is a chance, not rain.
const RAIN_TYPES = new Set([
  'WIND_AND_RAIN',
  'LIGHT_RAIN_SHOWERS',
  'SCATTERED_SHOWERS',
  'RAIN_SHOWERS',
  'HEAVY_RAIN_SHOWERS',
  'LIGHT_TO_MODERATE_RAIN',
  'MODERATE_TO_HEAVY_RAIN',
  'RAIN',
  'LIGHT_RAIN',
  'HEAVY_RAIN',
  'RAIN_PERIODICALLY_HEAVY',
  'RAIN_AND_SNOW',
  'HAIL',
  'HAIL_SHOWERS',
])
// THUNDERSTORM, THUNDERSHOWER, LIGHT_THUNDERSTORM_RAIN, SCATTERED_THUNDERSTORMS, HEAVY_THUNDERSTORM.
const isThunder = (type: string) => type.includes('THUNDER')

// At or above the configured rate; 0 means any rain at all.
const wet = (mm: number | null) => mm !== null && mm > 0 && mm >= config.weather.rainingMmPerHour

/** Returns the reading's verdicts with the configured thresholds (AC3). */
export function judge(
  reading: ProviderReading,
  located: WeatherReadingDto['located'],
  now = new Date(),
): WeatherReadingDto {
  const thunder = isThunder(reading.conditionType)
  const raining = thunder || RAIN_TYPES.has(reading.conditionType) || wet(reading.rainfallMm)
  const until = now.getTime() + FORECAST_MS
  const hours = reading.hours
    .filter((h) => h.to.getTime() > now.getTime() && h.from.getTime() < until)
    .map(judgeHour)
  return {
    observedAt: reading.observedAt.toISOString(),
    fetchedAt: now.toISOString(),
    timeZone: reading.timeZone,
    condition: reading.conditionText,
    raining,
    thunder,
    rainfallMmPerHour: reading.rainfallMm,
    temperatureC: reading.temperatureC,
    forecast: {
      hours,
      rainExpected: hours.some((h) => h.rain),
      thunderExpected: hours.some((h) => h.thunder),
    },
    located,
  }
}

function judgeHour(h: ProviderHour): ForecastHourDto {
  const likely = (percent: number | null) =>
    percent !== null && percent >= config.weather.rainExpectedPercent
  const thunder = isThunder(h.conditionType) || likely(h.thunderPercent)
  return {
    from: h.from.toISOString(),
    to: h.to.toISOString(),
    chancePercent: h.chancePercent,
    rainfallMm: h.rainfallMm,
    rain: thunder || likely(h.chancePercent) || wet(h.rainfallMm),
    thunder,
  }
}

// ----- Where the site is (AC1) -----

type SiteForWeather = {
  _id: { toString(): string }
  address?: string
  jurisdiction: string
  coordinates?: Point
  geocode?: IGeocode
}

type Located = { point: Point; located: WeatherReadingDto['located'] } | { missing: string | null }

const geocoding = new Map<string, Promise<Point | null>>()
// When a look-up last failed, by site and address, so a geocoder that is down isn't asked again
// for 30 seconds, as for readings.
const geocodeFailed = new Map<string, number>()

class GeocodeWaitError extends WeatherProviderError {
  constructor() {
    super('The geocoder', 'failed moments ago')
  }
}

// The site's pin, else its address's place: looked up once per address and kept on the site,
// only while the site still has that address (a correction in between wins). One look-up at a
// time per site and address. Throws WeatherProviderError when the geocoder can't be reached.
async function locate(site: SiteForWeather, key: string | undefined): Promise<Located | null> {
  if (site.coordinates) return { point: site.coordinates, located: 'pin' }
  const address = site.address?.trim()
  if (!address) return { missing: null }
  const known = site.geocode?.address === address ? site.geocode : undefined
  if (known) {
    return known.found && known.lat !== undefined && known.lng !== undefined
      ? { point: { lat: known.lat, lng: known.lng }, located: 'address' }
      : { missing: address }
  }
  if (!key) return null
  const id = `${site._id.toString()}|${address}`
  const failedAt = geocodeFailed.get(id)
  if (failedAt !== undefined && Date.now() - failedAt < WEATHER_RETRY_MS)
    throw new GeocodeWaitError()
  let lookup = geocoding.get(id)
  if (!lookup) {
    lookup = geocodeAddress(address, site.jurisdiction, key).then(async (point) => {
      const geocode: IGeocode = { address, found: !!point, ...point, at: new Date() }
      await SiteModel.updateOne({ _id: site._id, address: site.address }, { $set: { geocode } })
      return point
    })
    geocoding.set(id, lookup)
    void lookup.finally(() => geocoding.delete(id)).catch(() => undefined)
  }
  try {
    const point = await lookup
    geocodeFailed.delete(id)
    return point ? { point, located: 'address' } : { missing: address }
  } catch (error: unknown) {
    if (error instanceof WeatherProviderError) geocodeFailed.set(id, Date.now())
    throw error
  }
}

// ----- Readings, kept per site (AC5, AC6) -----

type Kept = {
  // The point the reading is for, so a moved pin or a corrected address reads afresh.
  at: string
  reading: WeatherReadingDto | null
  readAt: number
  failedAt: number | null
  // The last good reading's time and time zone, for "Weather unavailable" (AC6).
  lastReadingAt: string | null
  timeZone: string | null
}
const kept = new Map<string, Kept>()
const reading = new Map<string, Promise<WeatherReadingDto>>()

/** Forgets every kept reading and look-up; for tests. */
export function forgetSiteWeather() {
  kept.clear()
  reading.clear()
  geocoding.clear()
  geocodeFailed.clear()
}

const pointKey = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`

function unavailable(site: string): SiteWeatherDto {
  const last = kept.get(site)
  return {
    status: 'unavailable',
    lastReadingAt: last?.lastReadingAt ?? null,
    timeZone: last?.timeZone ?? null,
    source: WEATHER_SOURCE,
  }
}

async function weatherAt(
  site: string,
  where: { point: Point; located: WeatherReadingDto['located'] },
  key: string,
): Promise<SiteWeatherDto> {
  const now = Date.now()
  const at = pointKey(where.point)
  const last = kept.get(site)
  const same = last?.at === at
  if (same && last.reading && now - last.readAt < WEATHER_CACHE_MS)
    return { status: 'ok', reading: last.reading, source: WEATHER_SOURCE }
  if (same && last.failedAt !== null && now - last.failedAt < WEATHER_RETRY_MS)
    return unavailable(site)
  const id = `${site}|${at}`
  let pending = reading.get(id)
  if (!pending) {
    pending = readWeather(where.point, key).then((r) => judge(r, where.located))
    reading.set(id, pending)
    void pending.finally(() => reading.delete(id)).catch(() => undefined)
  }
  try {
    const fresh = await pending
    kept.set(site, {
      at,
      reading: fresh,
      readAt: Date.now(),
      failedAt: null,
      lastReadingAt: fresh.observedAt,
      timeZone: fresh.timeZone,
    })
    return { status: 'ok', reading: fresh, source: WEATHER_SOURCE }
  } catch (error: unknown) {
    if (!(error instanceof WeatherProviderError)) throw error
    console.error(`Site weather for ${site} failed:`, error.message)
    kept.set(site, {
      at,
      reading: null,
      readAt: 0,
      failedAt: Date.now(),
      lastReadingAt: last?.lastReadingAt ?? null,
      timeZone: last?.timeZone ?? null,
    })
    return unavailable(site)
  }
}

/**
 * Returns the weather at an assessment's site: `ok` with the reading, `no-address`,
 * `unconfigured` or `unavailable`. Throws AssessmentNotFoundError for an unknown reference.
 */
export async function siteWeather(reference: string): Promise<SiteWeatherDto> {
  const assessment = await AssessmentModel.findOne({ reference }, 'site').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const site = await SiteModel.findById(
    assessment.site,
    'address jurisdiction coordinates geocode',
  ).lean()
  if (!site) return { status: 'no-address', address: null }
  const id = site._id.toString()
  const key = config.weather.key
  let where: Located | null
  try {
    where = await locate(site, key)
  } catch (error: unknown) {
    if (!(error instanceof WeatherProviderError)) throw error
    if (!(error instanceof GeocodeWaitError))
      console.error(`Geocoding site ${id} failed:`, error.message)
    return unavailable(id)
  }
  if (where && 'missing' in where) return { status: 'no-address', address: where.missing }
  if (!where || !key) return { status: 'unconfigured' }
  return weatherAt(id, where, key)
}
