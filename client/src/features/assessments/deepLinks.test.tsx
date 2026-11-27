// MarshBot's links open the right place inside a tab (AS-06): which tab and params each link
// uses, and an observation's recording or page.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openOverviewLink, type LinkTargets } from './openOverviewLink'
import { useScrollToEvidence } from './useScrollToEvidence'
import { siteWalkReview } from '../site-walk/openReview'
import { SESSIONS } from '../../test/session'
import { placeAfterBack, useAssessmentWorkflow } from './useAssessmentWorkflow'
import { created, gateway, json } from '../new-assessment/testKit'
import { signal } from '../walkthrough/signals'

const scrolled: string[] = []
beforeEach(() => {
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id)
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('where a link goes', () => {
  const targets = (): LinkTargets => ({
    reference: 'RPT-1',
    setTab: vi.fn(),
    showObservation: vi.fn(),
    openDetails: vi.fn(),
    goTo: vi.fn(),
  })

  it('opens the checklist tab with its area or item for the tab to scroll to', () => {
    for (const params of [{ area: 'Construction' }, { item: 'i3' }] as Record<string, string>[]) {
      const t = targets()
      openOverviewLink({ tab: 'checklist', params }, t)
      expect(t.setTab).toHaveBeenCalledWith('checklist')
      expect(t.goTo).toHaveBeenCalledWith({ tab: 'checklist', params })
    }
  })

  it('opens Generation and Review on a section', () => {
    for (const tab of ['generate', 'review'] as const) {
      const t = targets()
      openOverviewLink({ tab, params: { section: '7' } }, t)
      expect(t.setTab).toHaveBeenCalledWith(tab)
      expect(t.goTo).toHaveBeenCalledWith({ tab, params: { section: '7' } })
    }
  })

  it('opens an observation, keeping its recording or page for the page to scroll to', () => {
    const t = targets()
    const link = { tab: 'observations' as const, params: { obs: 'o1', media: 'r1' } }
    openOverviewLink(link, t)
    expect(t.showObservation).toHaveBeenCalledWith('o1')
    expect(t.goTo).toHaveBeenCalledWith(link)
    expect(t.setTab).not.toHaveBeenCalled()
  })

  it('opens Details, or a site walk, without changing tab', () => {
    const t = targets()
    openOverviewLink({ tab: 'overview', params: { details: 'open' } }, t)
    expect(t.openDetails).toHaveBeenCalled()
    window.addEventListener(siteWalkReview.event, () => undefined, { once: true })
    openOverviewLink({ tab: 'observations', params: { walk: 'w1' } }, t)
    expect(siteWalkReview.walkId).toBe('w1')
    expect(t.setTab).not.toHaveBeenCalled()
  })
})

describe('an observation opened on a recording', () => {
  it('scrolls to it once it is drawn, and only once', () => {
    const { rerender } = renderHook(({ id }) => useScrollToEvidence(id), {
      initialProps: { id: 'r1' as string | undefined },
    })
    // Not drawn yet: nothing to scroll to.
    expect(scrolled).toEqual([])
    const el = document.body.appendChild(document.createElement('section'))
    el.id = 'evidence-r1'
    rerender({ id: 'r1' })
    rerender({ id: 'r1' })
    expect(scrolled).toEqual(['evidence-r1'])
    el.remove()
  })
})

describe('Back after a link opened another tab', () => {
  const open = () => {
    window.history.pushState({}, '', '/assessment?ref=RPT-2026-0411&tab=overview')
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    return renderHook(() => useAssessmentWorkflow(vi.fn(), SESSIONS.risk_engineer))
  }
  const at = () => new URLSearchParams(window.location.search).get('tab')

  it('returns to the Overview, and Forward returns to the tab', async () => {
    const { result } = open()
    const before = window.history.length
    act(() =>
      openOverviewLink(
        { tab: 'checklist', params: { area: 'Construction' } },
        {
          reference: 'RPT-2026-0411',
          setTab: result.current.setTab,
          showObservation: result.current.showObservation,
          openDetails: vi.fn(),
          goTo: vi.fn(),
        },
      ),
    )
    expect(at()).toBe('checklist')
    expect(window.history.length).toBe(before + 1)
    act(() => window.history.back())
    await waitFor(() => expect(result.current.tab).toBe('overview'))
    expect(at()).toBe('overview')
    act(() => window.history.forward())
    await waitFor(() => expect(result.current.tab).toBe('checklist'))
  })

  it('opens the default tab, not a blank workspace, when the URL names an unknown tab', () => {
    window.history.pushState({}, '', '/assessment?ref=RPT-2026-0411&tab=generation')
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    const { result } = renderHook(() => useAssessmentWorkflow(vi.fn(), SESSIONS.risk_engineer))
    expect(result.current.tab).toBe('overview')
  })

  // Round 9 design pass: the page title went blank after Back, because the URL holds no name.
  it('keeps the open assessment’s name and Recent list, since the URL knows only its reference', () => {
    const loaded = { reference: 'RPT-2026-0130', site: 'Senoko Chilled Hub' }
    const recent = [loaded, { reference: 'RPT-2026-0128', site: 'Changi Chilled Depot' }]
    const fromUrl = { reference: 'RPT-2026-0130', site: '' }
    const place = { captureTarget: fromUrl, recent: [fromUrl], tab: 'overview', obsOpen: null }
    expect(placeAfterBack({ captureTarget: loaded, recent }, place)).toEqual({
      ...place,
      captureTarget: loaded,
      recent,
    })
    // Another assessment: the URL's place stands, and its name comes from the work list.
    const other = { captureTarget: { reference: 'RPT-2026-0128', site: '' }, recent: [] }
    expect(placeAfterBack({ captureTarget: loaded, recent }, { ...place, ...other })).toEqual({
      ...place,
      ...other,
    })
  })

  // F-12: a walkthrough opens the practice assessment by URL just after making it, when the list
  // was read on another screen. Its page title was blank.
  it('names an assessment opened by URL from a list read on another screen', async () => {
    window.history.pushState({}, '', '/settings')
    gateway({
      'GET /api/assessments': () => json(200, [created('PRACTICE-0001', 'Harbourline Cold Store')]),
    })
    const { result } = renderHook(() => useAssessmentWorkflow(vi.fn(), SESSIONS.risk_engineer))
    act(() => signal('practice-changed'))
    act(() => {
      window.history.pushState(null, '', '/assessment?ref=PRACTICE-0001&tab=overview')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(result.current.title).toBe('Harbourline Cold Store'))
  })

  describe('the observation page’s own Back', () => {
    const q = (name: string) => new URLSearchParams(window.location.search).get(name)
    const openFromLink = (result: ReturnType<typeof open>['result']) =>
      act(() =>
        openOverviewLink(
          { tab: 'observations', params: { obs: 'o1', media: 'r1' } },
          {
            reference: 'RPT-2026-0411',
            setTab: result.current.setTab,
            showObservation: result.current.showObservation,
            openDetails: vi.fn(),
            goTo: vi.fn(),
          },
        ),
      )

    it('returns to the Overview when the observation was opened from a MarshBot link', async () => {
      const { result } = open()
      const before = window.history.length
      openFromLink(result)
      expect(q('obs')).toBe('o1')
      expect(window.history.length).toBe(before + 1)
      expect(result.current.obsViaOverview).toBe('o1')
      act(() => result.current.closeObs())
      await waitFor(() => expect(result.current.tab).toBe('overview'))
      expect(q('tab')).toBe('overview')
      expect(q('obs')).toBeNull()
    })

    it('goes to the Observations tab, as before, when it was opened from that tab', async () => {
      const { result } = open()
      act(() => result.current.setTab('observations'))
      act(() => result.current.openObs('o2'))
      expect(q('obs')).toBe('o2')
      expect(result.current.obsViaOverview).toBeNull()
      const before = window.history.length
      act(() => result.current.closeObs())
      await waitFor(() => expect(q('obs')).toBeNull())
      expect(q('tab')).toBe('observations')
      expect(result.current.tab).toBe('observations')
      expect(window.history.length).toBe(before)
    })

    it('forgets the link once another observation is stepped to, so Back goes to the list', async () => {
      const { result } = open()
      openFromLink(result)
      act(() => result.current.openObs('o3', true))
      await waitFor(() => expect(result.current.obsViaOverview).toBeNull())
      act(() => result.current.closeObs())
      await waitFor(() => expect(q('obs')).toBeNull())
      expect(q('tab')).toBe('observations')
    })
  })

  it('still only rewrites the entry for the tab strip, so Back leaves the screen', () => {
    const { result } = open()
    const before = window.history.length
    act(() => result.current.setTab('checklist'))
    expect(at()).toBe('checklist')
    expect(window.history.length).toBe(before)
  })
})
