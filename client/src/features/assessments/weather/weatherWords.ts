// What the site weather panel and a dashboard row say (CP-62), from the gateway's reading: the
// warning to show, the words for now and the next 2 hours, and times in the site's own time
// zone (AC6). Pure, so the tests can check every case. Used by SiteWeatherPanel.tsx and
// RowWeather.tsx.
import type { ForecastHour, SiteWeather, WeatherReading } from './api'

// A reading older than this is labelled stale (AC6).
export const STALE_MS = 30 * 60_000

// storm: thunder or lightning now; rain: raining now; expected: rain in the next 2 hours;
// dry: none of those; none: no reading to judge.
export type Tone = 'storm' | 'rain' | 'expected' | 'dry' | 'none'

export function toneOf(reading: WeatherReading | null): Tone {
  if (!reading) return 'none'
  if (reading.thunder) return 'storm'
  if (reading.raining) return 'rain'
  if (reading.forecast.rainExpected) return 'expected'
  return 'dry'
}

export const TONE_ICON: Record<Tone, string> = {
  storm: 'cloud-lightning',
  rain: 'cloud-rain',
  expected: 'cloud-drizzle',
  dry: 'cloud-sun',
  none: 'cloud-off',
}

export const readingOf = (weather: SiteWeather | null) =>
  weather?.status === 'ok' ? weather.reading : null

/** Returns whether the reading is older than 30 minutes (AC6). */
export const isStale = (reading: WeatherReading, now: Date) =>
  now.getTime() - Date.parse(reading.observedAt) > STALE_MS

// The site's zone when the browser knows it; otherwise the browser's own.
function partsIn(at: Date, timeZone: string | null) {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timeZone ?? undefined })
  } catch {
    format = new Intl.DateTimeFormat('en-GB', options)
  }
  const part = (type: string) => format.formatToParts(at).find((p) => p.type === type)?.value
  return { day: `${part('day')} ${part('month')}`, time: `${part('hour')}:${part('minute')}` }
}

/** Returns a time at the site, `14:02`, with its day (`22 Nov 14:02`) when not today there. */
export function siteTime(iso: string, timeZone: string | null, now = new Date()) {
  const at = partsIn(new Date(iso), timeZone)
  return at.day === partsIn(now, timeZone).day ? at.time : `${at.day} ${at.time}`
}

// `2.4`, `0`: one decimal at most.
const mm = (value: number) => String(Number(value.toFixed(1)))

/** Returns the words for now (AC2): the verdict, the provider's condition, rainfall, temperature. */
export function nowWords(reading: WeatherReading) {
  const lead = reading.thunder ? 'Thunderstorm' : reading.raining ? 'Raining' : 'No rain'
  return {
    lead,
    // Left out when it only says the lead again ("Thunderstorm · Thunderstorm").
    condition: reading.condition.toLowerCase() === lead.toLowerCase() ? null : reading.condition,
    rainfall: reading.rainfallMmPerHour === null ? null : `${mm(reading.rainfallMmPerHour)} mm/h`,
    temperature: reading.temperatureC === null ? null : `${Math.round(reading.temperatureC)}°C`,
  }
}

/** Returns each hour of the next 2 as the panel lists it: "Now" for the one under way. */
export function hourWords(hours: ForecastHour[], timeZone: string | null, now = new Date()) {
  return hours.map((h) => ({
    key: h.from,
    label: Date.parse(h.from) <= now.getTime() ? 'Now' : siteTime(h.from, timeZone, now),
    chance: h.chancePercent === null ? null : `${Math.round(h.chancePercent)}%`,
    rainfall: h.rainfallMm ? `${mm(h.rainfallMm)} mm` : null,
    rain: h.rain,
    thunder: h.thunder,
  }))
}

/** Returns the next 2 hours in a few words, for a dashboard row (AC2). */
export function nextWords(reading: WeatherReading) {
  const { rainExpected, thunderExpected } = reading.forecast
  if (thunderExpected) return 'Storms possible in the next 2\u00a0h'
  return rainExpected
    ? 'Rain expected in the next 2\u00a0h'
    : 'No rain expected in the next 2\u00a0h'
}

// When the first wet hour starts, at the site: "now" when it is under way.
function fromWhen(hour: ForecastHour, timeZone: string | null, now: Date) {
  return Date.parse(hour.from) <= now.getTime()
    ? 'from now'
    : `from ${siteTime(hour.from, timeZone, now)} site time`
}

export type Banner = { tone: 'storm' | 'rain' | 'expected'; title: string; detail: string | null }

/**
 * Returns the one warning to show, the strongest first (AC3): a thunderstorm, rain now, or rain
 * in the next 2 hours; null when dry.
 */
export function bannerOf(reading: WeatherReading, now = new Date()): Banner | null {
  if (reading.thunder)
    return {
      tone: 'storm',
      title:
        'Thunderstorm at site – do not proceed with any outdoor, roof or below-ground inspection.',
      detail: 'Lightning is a risk, so stay under cover until 30 minutes after the last thunder.',
    }
  if (reading.raining)
    return {
      tone: 'rain',
      title: 'Raining at site – do not proceed with outdoor or below-ground inspection.',
      detail: null,
    }
  const wet = reading.forecast.hours.filter((h) => h.rain)
  if (!wet.length) return null
  const when = fromWhen(wet[0], reading.timeZone, now)
  if (reading.forecast.thunderExpected)
    return {
      tone: 'expected',
      title: 'Rain expected',
      detail: `Thunderstorms are possible ${when}, so plan outdoor, roof and below-ground work around them.`,
    }
  const chances = wet.map((h) => h.chancePercent).filter((c): c is number => c !== null)
  const most = Math.max(0, ...wet.map((h) => h.rainfallMm ?? 0))
  const what = chances.length
    ? `Up to a ${Math.round(Math.max(...chances))}% chance of rain`
    : `Rain of up to ${mm(most)} mm/h`
  return {
    tone: 'expected',
    title: 'Rain expected',
    detail: `${what} ${when}, so plan outdoor and below-ground work around it.`,
  }
}

/** Returns the advisory line every warning carries, naming the source (AC4). */
export const advisoryWords = (sourceName: string) =>
  `Advisory only, from ${sourceName}: check conditions on arrival. It doesn't stop you recording observations.`

/** Returns whether today, on this browser's calendar, falls within the visit's days (AC2). */
export function visitToday(
  start: string | null | undefined,
  end: string | null | undefined,
  now = new Date(),
) {
  if (!start) return false
  const today = now.toLocaleDateString('en-CA')
  return start <= today && today <= (end && end > start ? end : start)
}
