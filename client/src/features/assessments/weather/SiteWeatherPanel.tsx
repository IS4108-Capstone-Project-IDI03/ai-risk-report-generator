// The site weather panel (CP-62): whether it is raining or stormy at the assessment's site now,
// rainfall, temperature and the rain forecast for the next 2 hours, with the one warning that
// applies (AC3), the source and that it is advisory (AC4), when it was last updated in the
// site's own time (AC6), and a 44 px Refresh (AC7). It blocks nothing: an engineer may be
// recording at their desk. A bar across the top of the Overview's conversation
// (marshbot/screens/MarshBotOverview.tsx) and a slim card in New Observation's header, above its
// form on a phone (screens/SiteObservation.tsx). Calls useSiteWeather.ts.
import { Icon, IconButton } from '../../../design-system'
import type { SiteWeather, WeatherReading, WeatherSource } from './api'
import { useSiteWeather } from './useSiteWeather'
import {
  advisoryWords,
  bannerOf,
  hourWords,
  isStale,
  nowWords,
  readingOf,
  siteTime,
  TONE_ICON,
  toneOf,
  type Banner,
  type Tone,
} from './weatherWords'
import './weather.css'

type Props = {
  // The saved assessment; a sample one (null) has no site on the gateway, so no panel.
  reference: string | null
  layout: 'bar' | 'card'
}

/** Returns the weather panel for the assessment's site, kept current while it is shown. */
export function SiteWeatherPanel({ reference, layout }: Props) {
  const { weather, refreshing, refresh, now } = useSiteWeather(reference)
  if (!reference) return null
  const reading = readingOf(weather)
  const tone: Tone = weather ? toneOf(reading) : 'none'
  const banner = reading && bannerOf(reading, now)
  const source = weather && 'source' in weather ? weather.source : null
  return (
    <section
      className="wx"
      data-layout={layout}
      aria-label="Site weather"
      aria-busy={refreshing || undefined}
    >
      <div className="wx-in">
        {banner && <WeatherBanner banner={banner} source={source} />}
        <div className="wx-row">
          <span className="wx-tile" data-tone={weather ? tone : 'loading'} aria-hidden="true">
            <Icon
              name={
                weather
                  ? weather.status === 'no-address'
                    ? 'map-pin-off'
                    : TONE_ICON[tone]
                  : 'cloud'
              }
              size={20}
            />
          </span>
          <div className="wx-text">
            {!weather ? (
              <p className="wx-lead">{'Checking the weather at the site…'}</p>
            ) : weather.status === 'ok' ? (
              <Conditions reading={weather.reading} source={weather.source} now={now} />
            ) : (
              <NoReading weather={weather} now={now} />
            )}
          </div>
          {/* No weather service is set up: refreshing could never bring a reading. */}
          {weather?.status !== 'unconfigured' && (
            <IconButton
              icon="refresh-cw"
              size="lg"
              label="Refresh site weather"
              tooltip="Refresh"
              className="wx-refresh"
              data-busy={refreshing || undefined}
              aria-disabled={refreshing || undefined}
              onClick={() => {
                if (!refreshing) refresh()
              }}
            />
          )}
        </div>
      </div>
    </section>
  )
}

// The one warning (AC3), with its source and that it is advisory (AC4). A thunderstorm is an
// alert; rain now or soon is said politely.
function WeatherBanner({ banner, source }: { banner: Banner; source: WeatherSource | null }) {
  const icon =
    banner.tone === 'storm'
      ? 'cloud-lightning'
      : banner.tone === 'rain'
        ? 'cloud-rain'
        : 'cloud-drizzle'
  return (
    <div
      className="wx-banner"
      data-tone={banner.tone}
      role={banner.tone === 'storm' ? 'alert' : 'status'}
    >
      <Icon name={icon} size={20} />
      <div className="wx-banner-text">
        <p className="wx-banner-title">{banner.title}</p>
        {banner.detail && <p>{banner.detail}</p>}
        <p className="wx-banner-source">{advisoryWords(source?.name ?? 'the weather service')}</p>
      </div>
    </div>
  )
}

// Now (AC2): Raining or No rain, the provider's words, rainfall and temperature; the next 2
// hours; then when it was updated, stale past 30 minutes (AC6), and the source.
function Conditions({
  reading,
  source,
  now,
}: {
  reading: WeatherReading
  source: WeatherSource | null
  now: Date
}) {
  const words = nowWords(reading)
  const hours = hourWords(reading.forecast.hours, reading.timeZone, now)
  const stale = isStale(reading, now)
  return (
    <>
      <p className="wx-lead">
        <b>{words.lead}</b>
        <Parts parts={[words.condition, words.rainfall, words.temperature]} />
      </p>
      <p className="wx-next">
        <span className="wx-label">{'Next 2 hours'}</span>
        {hours.length ? (
          <span className="wx-hours">
            {hours.map((h) => (
              <span key={h.key} className="wx-hour" data-rain={h.rain || undefined}>
                <span>{h.label}</span>
                <b>{h.chance ?? '–'}</b>
                {h.rainfall && <span>{h.rainfall}</span>}
                {h.thunder && <Icon name="zap" size={12} title="Thunder possible" />}
              </span>
            ))}
          </span>
        ) : (
          <span>{'No forecast'}</span>
        )}
      </p>
      <p className="wx-meta">
        <span className="wx-part">{`Updated ${siteTime(reading.observedAt, reading.timeZone, now)} site time`}</span>
        {stale && (
          <>
            {' '}
            <span className="wx-stale" title="This reading is more than 30 minutes old.">
              {'Stale'}
            </span>
          </>
        )}
        <Parts parts={[source && `${source.name} · Advisory only`]} />
      </p>
    </>
  )
}

// The items after the first on a line, each kept whole and joined by a dot that stays at the end
// of a line when it wraps, never at the start of the next.
function Parts({ parts }: { parts: (string | null | false | undefined)[] }) {
  return (
    <>
      {parts.filter(Boolean).map((part) => (
        <span key={part as string}>
          {'\u00a0· '}
          <span className="wx-part">{part}</span>
        </span>
      ))}
    </>
  )
}

// No reading to show (AC1, AC6): no address, no weather service set up, or none reachable.
function NoReading({
  weather,
  now,
}: {
  weather: Exclude<SiteWeather, { status: 'ok' }>
  now: Date
}) {
  if (weather.status === 'no-address')
    return (
      <>
        <p className="wx-lead">
          <b>{'Add the site address to see weather'}</b>
        </p>
        <p className="wx-meta">
          {weather.address
            ? `“${weather.address}” couldn't be found on the map. Correct it in the site's details, or pin the site on its map.`
            : "This site has no address yet. Add one in the site's details, or pin the site on its map."}
        </p>
      </>
    )
  if (weather.status === 'unconfigured')
    return (
      <>
        <p className="wx-lead">
          <b>{'Weather unavailable'}</b>
        </p>
        <p className="wx-meta">{"Site weather isn't set up in this app yet."}</p>
      </>
    )
  return (
    <>
      <p className="wx-lead">
        <b>{'Weather unavailable'}</b>
      </p>
      <p className="wx-meta">
        {`${weather.source ? weather.source.name : 'The weather service'} can't be reached right now, and ` +
          (weather.lastReadingAt
            ? `the last reading was taken at ${siteTime(weather.lastReadingAt, weather.timeZone, now)} site time.`
            : 'no reading has been taken yet.')}
      </p>
    </>
  )
}
