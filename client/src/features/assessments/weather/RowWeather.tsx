// The site's weather on a dashboard row with a site visit today (CP-62 AC2): one line under the
// reference, "Raining · 2.4 mm/h · 27°C · Rain expected in the next 2 h · Updated 16:52", red for
// rain or a storm now and amber for rain expected. It refreshes itself every 10 minutes
// (useSiteWeather.ts); the panel on the Overview has the Refresh button and the full warning.
// Used by components/WorkRow.tsx.
import { Icon } from '../../../design-system'
import { useSiteWeather } from './useSiteWeather'
import {
  isStale,
  nextWords,
  nowWords,
  readingOf,
  siteTime,
  TONE_ICON,
  toneOf,
} from './weatherWords'

export function RowWeather({ reference }: { reference: string }) {
  const { weather, now } = useSiteWeather(reference)
  const reading = readingOf(weather)
  if (!weather)
    return (
      <span className="wx-rowline" data-tone="loading">
        {'Checking site weather…'}
      </span>
    )
  if (!reading)
    return (
      <span className="wx-rowline" data-tone="none">
        <Icon name={weather.status === 'no-address' ? 'map-pin-off' : 'cloud-off'} size={14} />
        <span>
          {weather.status === 'no-address'
            ? 'Add the site address to see weather'
            : 'Weather unavailable'}
          {weather.status === 'unavailable' &&
            weather.lastReadingAt &&
            ` · Last reading ${siteTime(weather.lastReadingAt, weather.timeZone, now)}`}
        </span>
      </span>
    )
  const tone = toneOf(reading)
  const words = nowWords(reading)
  const updated = `Updated ${siteTime(reading.observedAt, reading.timeZone, now)}`
  const stale = isStale(reading, now)
  const source = weather.status === 'ok' ? weather.source.name : ''
  return (
    <span
      className="wx-rowline"
      data-tone={tone}
      title={`Site weather, advisory only, from ${source}. Times are the site's.`}
    >
      <Icon name={TONE_ICON[tone]} size={14} />
      <span>
        <b>{words.lead}</b>
        {[words.rainfall, words.temperature, nextWords(reading)].filter(Boolean).map((part) => (
          <span key={part}>
            {'\u00a0· '}
            <span className="wx-part">{part}</span>
          </span>
        ))}
        <span className="wx-rowline-time">
          {'\u00a0· '}
          <span className="wx-part">{updated + (stale ? ' (stale)' : '')}</span>
        </span>
      </span>
    </span>
  )
}
