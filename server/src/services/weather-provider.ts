// The weather provider behind a site's weather (CP-62): Google's Geocoding API finds the site's
// address, and its Weather API reads the conditions there now and over the next hours. Only
// site-weather.service.ts calls this, and only the gateway holds the key (config.weather.key):
// it never reaches a browser. Everything leaves here in the provider's own words, plain numbers
// and dates; what counts as rain is decided in site-weather.service.ts.
//
// The key travels in the URL, as Google's REST APIs take it, so a URL is never logged or put in
// an error message.

export type Point = { lat: number; lng: number }

// Named on every reading the panel shows (AC4).
export const WEATHER_SOURCE = {
  name: 'Google Weather',
  url: 'https://developers.google.com/maps/documentation/weather',
}

// The conditions now, and the hours of the forecast from the current one on.
export type ProviderReading = {
  observedAt: Date
  // The site's IANA time zone, e.g. Asia/Singapore, which its times are shown in (AC6).
  timeZone: string | null
  // The provider's code (RAIN, THUNDERSTORM, ...) and its words ("Light rain").
  conditionType: string
  conditionText: string
  // Rain in the last hour (mm), so mm/h.
  rainfallMm: number | null
  temperatureC: number | null
  hours: ProviderHour[]
}

export type ProviderHour = {
  from: Date
  to: Date
  conditionType: string
  chancePercent: number | null
  rainfallMm: number | null
  thunderPercent: number | null
}

// The provider couldn't be reached, timed out or refused the request. Never "no such place":
// that is geocodeAddress's null.
export class WeatherProviderError extends Error {
  constructor(what: string, cause: string) {
    super(`${what}: ${cause}`)
    this.name = 'WeatherProviderError'
  }
}

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const CURRENT_URL = 'https://weather.googleapis.com/v1/currentConditions:lookup'
const HOURS_URL = 'https://weather.googleapis.com/v1/forecast/hours:lookup'
// Long enough for a slow answer, short enough that a panel isn't left waiting.
const TIMEOUT_MS = 8_000

async function getJson(what: string, url: URL): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error: unknown) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new WeatherProviderError(what, timedOut ? 'timed out' : 'could not be reached')
  }
  if (!response.ok) throw new WeatherProviderError(what, `answered ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new WeatherProviderError(what, 'answered with something other than JSON')
  }
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
// A field of an object the provider sent, whatever shape it really has.
const field = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined),
    value,
  )

// A result that is a whole country or state ("Singapore", "Johor") is a guess at where the site
// is, not a find (AC1). Google types it country or administrative_area_level_1, beside political.
const TOO_COARSE = new Set(['country', 'administrative_area_level_1'])

/**
 * Returns where an address is, or null when the geocoder knows no such place or only its country
 * or state. Throws WeatherProviderError when the geocoder can't be reached or refuses. `region`
 * is the site's two-letter jurisdiction, which favours places there.
 */
export async function geocodeAddress(
  address: string,
  region: string | undefined,
  key: string,
): Promise<Point | null> {
  const url = new URL(GEOCODE_URL)
  url.searchParams.set('address', address)
  if (region && /^[a-z]{2}$/i.test(region)) url.searchParams.set('region', region.toLowerCase())
  url.searchParams.set('key', key)
  const body = await getJson('The geocoder', url)
  const status = text(field(body, 'status'))
  if (status === 'ZERO_RESULTS') return null
  if (status !== 'OK') throw new WeatherProviderError('The geocoder', `answered ${status}`)
  const first = (field(body, 'results') as unknown[] | undefined)?.[0]
  const types = (field(first, 'types') as unknown[] | undefined) ?? []
  if (types.some((t) => TOO_COARSE.has(text(t)))) return null
  const lat = num(field(first, 'geometry', 'location', 'lat'))
  const lng = num(field(first, 'geometry', 'location', 'lng'))
  return lat === null || lng === null ? null : { lat, lng }
}

/**
 * Returns the street address nearest a point (reverse geocoding), or null when Google has none.
 * Throws WeatherProviderError when the geocoder can't be reached or refuses. Used by the mobile
 * new-site form: the engineer sets the pin and the Address fills in (GET /api/sites/address).
 */
export async function addressAt(point: Point, key: string): Promise<string | null> {
  const url = new URL(GEOCODE_URL)
  url.searchParams.set('latlng', `${point.lat},${point.lng}`)
  url.searchParams.set('key', key)
  const body = await getJson('The geocoder', url)
  const status = text(field(body, 'status'))
  if (status === 'ZERO_RESULTS') return null
  if (status !== 'OK') throw new WeatherProviderError('The geocoder', `answered ${status}`)
  const first = (field(body, 'results') as unknown[] | undefined)?.[0]
  return text(field(first, 'formatted_address')) || null
}

function weatherUrl(base: string, point: Point, key: string) {
  const url = new URL(base)
  url.searchParams.set('location.latitude', String(point.lat))
  url.searchParams.set('location.longitude', String(point.lng))
  url.searchParams.set('unitsSystem', 'METRIC')
  url.searchParams.set('key', key)
  return url
}

const dateOf = (value: unknown): Date | null => {
  const at = new Date(text(value))
  return Number.isNaN(at.getTime()) ? null : at
}

function hourOf(raw: unknown): ProviderHour | null {
  const from = dateOf(field(raw, 'interval', 'startTime'))
  const to = dateOf(field(raw, 'interval', 'endTime'))
  if (!from || !to) return null
  return {
    from,
    to,
    conditionType: text(field(raw, 'weatherCondition', 'type')),
    chancePercent: num(field(raw, 'precipitation', 'probability', 'percent')),
    rainfallMm: num(field(raw, 'precipitation', 'qpf', 'quantity')),
    thunderPercent: num(field(raw, 'thunderstormProbability')),
  }
}

/**
 * Returns the conditions at a point now and the next three hours of its forecast, starting
 * with the current hour. Throws WeatherProviderError when either can't be read.
 */
export async function readWeather(point: Point, key: string): Promise<ProviderReading> {
  const hoursUrl = weatherUrl(HOURS_URL, point, key)
  hoursUrl.searchParams.set('hours', '3')
  const [now, forecast] = await Promise.all([
    getJson('The weather service', weatherUrl(CURRENT_URL, point, key)),
    getJson('The weather forecast', hoursUrl),
  ])
  const observedAt = dateOf(field(now, 'currentTime'))
  if (!observedAt) throw new WeatherProviderError('The weather service', 'sent no reading time')
  const hours = ((field(forecast, 'forecastHours') as unknown[] | undefined) ?? [])
    .map(hourOf)
    .filter((h): h is ProviderHour => !!h)
  return {
    observedAt,
    timeZone: text(field(now, 'timeZone', 'id')) || text(field(forecast, 'timeZone', 'id')) || null,
    conditionType: text(field(now, 'weatherCondition', 'type')),
    conditionText: text(field(now, 'weatherCondition', 'description', 'text')),
    rainfallMm: num(field(now, 'precipitation', 'qpf', 'quantity')),
    temperatureC: num(field(now, 'temperature', 'degrees')),
    hours,
  }
}
