// The site's weather (CP-62), read from GET /api/assessments/:reference/weather. The gateway
// calls the weather provider with its own key and keeps a reading for 10 minutes per site; the
// browser never talks to the provider. Shapes match server/src/services/site-weather.service.ts.
import { GatewayError, request } from '../api'

export type WeatherSource = { name: string; url: string }

export type ForecastHour = {
  from: string
  to: string
  chancePercent: number | null
  rainfallMm: number | null
  rain: boolean
  thunder: boolean
}

export type WeatherReading = {
  // When the provider took it and when the gateway fetched it (ISO, UTC).
  observedAt: string
  fetchedAt: string
  // The site's time zone (IANA), which every time is shown in (AC6).
  timeZone: string | null
  condition: string
  raining: boolean
  thunder: boolean
  rainfallMmPerHour: number | null
  temperatureC: number | null
  forecast: { hours: ForecastHour[]; rainExpected: boolean; thunderExpected: boolean }
  located: 'pin' | 'address'
}

export type SiteWeather =
  // No address and no pin, or `address` couldn't be found on the map (AC1).
  | { status: 'no-address'; address: string | null }
  // The server has no weather key.
  | { status: 'unconfigured' }
  // The provider, or the gateway (`source` null), couldn't be reached (AC6).
  | {
      status: 'unavailable'
      lastReadingAt: string | null
      timeZone: string | null
      source: WeatherSource | null
    }
  | { status: 'ok'; reading: WeatherReading; source: WeatherSource }

const STATUSES: SiteWeather['status'][] = ['ok', 'no-address', 'unconfigured', 'unavailable']

/**
 * Returns the weather at the assessment's site, as the gateway last read it. Anything but one of
 * its answers (a proxy's page, an old gateway) throws, as an unreachable gateway does.
 */
export async function fetchSiteWeather(reference: string, signal?: AbortSignal) {
  const { status, data } = await request<SiteWeather>(
    'GET',
    `/api/assessments/${encodeURIComponent(reference)}/weather`,
    undefined,
    signal,
  )
  const known =
    !!data && typeof data === 'object' && STATUSES.includes((data as SiteWeather).status)
  if (!known) throw new GatewayError(status, 'The gateway sent no site weather.')
  return data
}
