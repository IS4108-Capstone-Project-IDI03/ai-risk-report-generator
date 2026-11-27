// CP-62: the site weather panel, its words and a dashboard row's weather line, with the
// gateway's GET /api/assessments/:reference/weather faked.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteWeather, WeatherReading } from './api'
import { RowWeather } from './RowWeather'
import { SiteWeatherPanel } from './SiteWeatherPanel'
import { bannerOf, hourWords, isStale, siteTime, visitToday } from './weatherWords'

const NOW = new Date('2026-11-23T08:40:00Z') // 16:40 in Singapore
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

function reading(over: Partial<WeatherReading> = {}): WeatherReading {
  return {
    observedAt: NOW.toISOString(),
    fetchedAt: NOW.toISOString(),
    timeZone: 'Asia/Singapore',
    condition: 'Cloudy',
    raining: false,
    thunder: false,
    rainfallMmPerHour: 0,
    temperatureC: 29.4,
    forecast: {
      hours: [
        {
          from: at(-40 * 60_000),
          to: at(20 * 60_000),
          chancePercent: 10,
          rainfallMm: 0,
          rain: false,
          thunder: false,
        },
        {
          from: at(20 * 60_000),
          to: at(80 * 60_000),
          chancePercent: 20,
          rainfallMm: 0,
          rain: false,
          thunder: false,
        },
        {
          from: at(80 * 60_000),
          to: at(140 * 60_000),
          chancePercent: 30,
          rainfallMm: 0,
          rain: false,
          thunder: false,
        },
      ],
      rainExpected: false,
      thunderExpected: false,
    },
    located: 'address',
    ...over,
  }
}
const SOURCE = {
  name: 'Google Weather',
  url: 'https://developers.google.com/maps/documentation/weather',
}
const ok = (over: Partial<WeatherReading> = {}): SiteWeather => ({
  status: 'ok',
  reading: reading(over),
  source: SOURCE,
})
const wetSoon = () =>
  reading({
    forecast: {
      ...reading().forecast,
      hours: reading().forecast.hours.map((h, i) =>
        i === 1 ? { ...h, chancePercent: 60, rainfallMm: 1.2, rain: true } : h,
      ),
      rainExpected: true,
    },
  })

// The gateway: each call answers the next of `answers`, or the last one again.
let answers: (SiteWeather | 'down')[]
const asked: string[] = []
function gateway(url: string | URL | Request) {
  asked.push(String(url))
  const next = answers.length > 1 ? answers.shift()! : answers[0]
  if (next === 'down') return Promise.reject(new TypeError('Failed to fetch'))
  return Promise.resolve(
    new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}
// Moves the fake clock on by `ms`, then lets the gateway's answer land and React render it: the
// answer is a few promises long (fetch, its body, the state), so it gets a few more turns.
async function wait(ms = 0) {
  await act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
  for (let i = 0; i < 3; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  vi.setSystemTime(NOW)
  answers = [ok()]
  asked.length = 0
  vi.stubGlobal('fetch', vi.fn(gateway))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function open(layout: 'bar' | 'card' = 'card', reference: string | null = 'RPT-2026-0411') {
  const view = render(<SiteWeatherPanel reference={reference} layout={layout} />)
  await wait()
  return view
}
const panel = () => screen.getByRole('region', { name: 'Site weather' })

describe('the words (AC3, AC6)', () => {
  it('shows times in the site’s own time zone, with the day when it is not today there', () => {
    expect(siteTime('2026-11-23T08:52:00Z', 'Asia/Singapore', NOW)).toBe('16:52')
    expect(siteTime('2026-11-23T08:52:00Z', 'Europe/London', NOW)).toBe('08:52')
    expect(siteTime('2026-11-22T15:00:00Z', 'Asia/Singapore', NOW)).toBe('22 Nov 23:00')
  })

  it('labels a reading stale only once it is more than 30 minutes old', () => {
    expect(isStale(reading({ observedAt: at(-30 * 60_000) }), NOW)).toBe(false)
    expect(isStale(reading({ observedAt: at(-31 * 60_000) }), NOW)).toBe(true)
  })

  it('names the hour under way Now, and the rest by their start at the site', () => {
    expect(hourWords(reading().forecast.hours, 'Asia/Singapore', NOW).map((h) => h.label)).toEqual([
      'Now',
      '17:00',
      '18:00',
    ])
  })

  it('shows the strongest warning only: a storm, then rain now, then rain expected', () => {
    expect(bannerOf(reading({ raining: true, thunder: true }), NOW)?.tone).toBe('storm')
    expect(bannerOf(reading({ raining: true }), NOW)).toEqual({
      tone: 'rain',
      title: 'Raining at site – do not proceed with outdoor or below-ground inspection.',
      detail: null,
    })
    expect(bannerOf(wetSoon(), NOW)).toEqual({
      tone: 'expected',
      title: 'Rain expected',
      detail:
        'Up to a 60% chance of rain from 17:00 site time, so plan outdoor and below-ground work around it.',
    })
    expect(bannerOf(reading(), NOW)).toBeNull()
  })

  it('counts a visit over several days as today on each of them', () => {
    expect(visitToday('2026-11-23', null, NOW)).toBe(true)
    expect(visitToday('2026-11-22', '2026-11-24', NOW)).toBe(true)
    expect(visitToday('2026-11-24', null, NOW)).toBe(false)
    expect(visitToday(null, null, NOW)).toBe(false)
  })
})

describe('the panel (AC2-AC4)', () => {
  it('shows rain or no rain, rainfall, temperature and the next 2 hours, and when, in site time', async () => {
    await open()
    expect(panel()).toHaveTextContent('No rain')
    expect(panel()).toHaveTextContent('0 mm/h')
    expect(panel()).toHaveTextContent('29°C')
    expect(panel()).toHaveTextContent(/Next 2 hours\s*Now\s*10%\s*17:00\s*20%\s*18:00\s*30%/)
    expect(panel()).toHaveTextContent('Updated 16:40 site time')
    expect(panel()).toHaveTextContent('Google Weather · Advisory only')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(asked).toEqual(['/api/assessments/RPT-2026-0411/weather'])
  })

  it('warns when it is raining at the site, naming the source and that it is advisory', async () => {
    answers = [ok({ raining: true, condition: 'Light rain', rainfallMmPerHour: 2.4 })]
    await open()
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent(
      'Raining at site – do not proceed with outdoor or below-ground inspection.',
    )
    expect(warning).toHaveTextContent('Advisory only, from Google Weather')
    expect(warning).toHaveTextContent("It doesn't stop you recording observations.")
    expect(panel()).toHaveTextContent('Raining')
    expect(panel()).toHaveTextContent('2.4 mm/h')
  })

  it('gives a stronger warning for a thunderstorm', async () => {
    answers = [ok({ raining: true, thunder: true, condition: 'Thunderstorm' })]
    await open()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/^Thunderstorm at site – do not proceed with any outdoor, roof/)
    expect(alert).toHaveTextContent('Advisory only, from Google Weather')
    expect(screen.queryByText(/^Raining at site/)).not.toBeInTheDocument()
  })

  it('shows an amber Rain expected notice when rain is forecast in the next 2 hours', async () => {
    answers = [{ status: 'ok', reading: wetSoon(), source: SOURCE }]
    await open()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Rain expected' +
        'Up to a 60% chance of rain from 17:00 site time, so plan outdoor and below-ground work around it.',
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'expected')
  })

  it('asks for the address rather than guessing (AC1)', async () => {
    answers = [{ status: 'no-address', address: null }]
    await open()
    expect(panel()).toHaveTextContent('Add the site address to see weather')
    cleanup()
    answers = [{ status: 'no-address', address: '2 Jurong Port Rd' }]
    await open()
    expect(panel()).toHaveTextContent('Add the site address to see weather')
    expect(panel()).toHaveTextContent("“2 Jurong Port Rd” couldn't be found on the map.")
  })

  it('says weather is not set up, with no Refresh, when the gateway has no weather key', async () => {
    answers = [{ status: 'unconfigured' }]
    await open()
    expect(panel()).toHaveTextContent("Site weather isn't set up in this app yet.")
    expect(screen.queryByRole('button', { name: 'Refresh site weather' })).not.toBeInTheDocument()
  })

  it('shows nothing without an assessment reference', async () => {
    await open('card', null)
    expect(screen.queryByRole('region', { name: 'Site weather' })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('freshness (AC6)', () => {
  it('labels the reading stale once it is more than 30 minutes old', async () => {
    answers = [ok({ observedAt: at(-25 * 60_000) })]
    await open()
    expect(screen.queryByText('Stale')).not.toBeInTheDocument()
    await wait(6 * 60_000)
    expect(screen.getByText('Stale')).toBeInTheDocument()
  })

  it('says unavailable with the last reading’s time, never showing an old reading as current', async () => {
    answers = [
      {
        status: 'unavailable',
        lastReadingAt: at(-45 * 60_000),
        timeZone: 'Asia/Singapore',
        source: SOURCE,
      },
    ]
    await open()
    expect(panel()).toHaveTextContent('Weather unavailable')
    expect(panel()).toHaveTextContent(
      "Google Weather can't be reached right now, and the last reading was taken at 15:55 site time.",
    )
    expect(panel()).not.toHaveTextContent('mm/h')
  })

  it('drops the reading it showed when the gateway can no longer be reached', async () => {
    answers = [ok({ raining: true, rainfallMmPerHour: 3 }), 'down']
    await open()
    expect(panel()).toHaveTextContent('3 mm/h')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh site weather' }))
    await wait()
    expect(panel()).toHaveTextContent('Weather unavailable')
    expect(panel()).toHaveTextContent('the last reading was taken at 16:40 site time')
    expect(panel()).not.toHaveTextContent('3 mm/h')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('refreshing (AC7)', () => {
  it('reads again every 10 minutes while open, and stops once closed', async () => {
    const { unmount } = await open('bar')
    await wait(9 * 60_000)
    expect(asked).toHaveLength(1)
    await wait(60_000)
    expect(asked).toHaveLength(2)
    await wait(10 * 60_000)
    expect(asked).toHaveLength(3)
    unmount()
    await wait(20 * 60_000)
    expect(asked).toHaveLength(3)
  })

  it('reads again at once on Refresh, a large round button', async () => {
    answers = [ok(), ok({ raining: true })]
    await open()
    const refresh = screen.getByRole('button', { name: 'Refresh site weather' })
    // The design system's large icon button: 46 px, above the 44 px glove-sized target.
    expect(refresh).toHaveStyle({ height: 'var(--control-height-lg)' })
    fireEvent.click(refresh)
    await wait()
    expect(asked).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('Raining at site')
  })

  it('skips its turn while the tab is hidden and reads as soon as it is shown', async () => {
    const shown = (value: string) =>
      Object.defineProperty(document, 'visibilityState', { value, configurable: true })
    await open()
    shown('hidden')
    try {
      await wait(15 * 60_000)
      expect(asked).toHaveLength(1)
    } finally {
      shown('visible')
    }
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    await wait()
    expect(asked).toHaveLength(2)
  })
})

describe('a dashboard row with a site visit today (AC2)', () => {
  it('shows the conditions, the next 2 hours and when, in one line', async () => {
    answers = [
      {
        status: 'ok',
        reading: { ...wetSoon(), raining: true, rainfallMmPerHour: 2.4, temperatureC: 27.2 },
        source: SOURCE,
      },
    ]
    render(<RowWeather reference="RPT-2026-0411" />)
    await wait()
    expect(screen.getByText(/Raining/).closest('.wx-rowline')).toHaveTextContent(
      'Raining · 2.4 mm/h · 27°C · Rain expected in the next 2 h · Updated 16:40',
    )
  })

  it('shows nothing when no weather service is set up', async () => {
    answers = [{ status: 'unconfigured' }]
    const { container } = render(<RowWeather reference="RPT-2026-0411" />)
    await wait()
    expect(container).toBeEmptyDOMElement()
  })
})
