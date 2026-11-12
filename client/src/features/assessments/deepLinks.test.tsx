// MarshBot's links open the right place inside a tab (AS-06): which tab and params each link
// uses, a report section on Generation, and an observation's recording or page.
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportSection } from './api'
import { openOverviewLink, type LinkTargets } from './openOverviewLink'
import { SectionDrafts } from './screens/SectionDrafts'
import { useScrollToEvidence } from './useScrollToEvidence'
import { siteWalkReview } from '../site-walk/openReview'

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

describe('Generation opened on a section', () => {
  const section = (id: string, title: string): ReportSection => ({
    id,
    title,
    copeDimensions: ['Construction'],
    minObservations: 1,
    usableObservations: 1,
    latestDraft: null,
    inputsMissing: null,
    changesSinceDraft: 0,
    changeCounts: { added: 0, changed: 0, removed: 0 },
  })

  it('scrolls to that section’s row once the sections are in', async () => {
    const list = [section('7', 'Construction'), section('8', 'Protection')]
    vi.stubGlobal('fetch', (url: string) => {
      const body = url.endsWith('/sections')
        ? list
        : url.endsWith('/ofis')
          ? { suggestions: [], accepted: [] }
          : []
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    render(<SectionDrafts reference="RPT-1" canDraft onReview={() => undefined} openSection="8" />)
    await screen.findByText('Protection')
    await waitFor(() => expect(scrolled).toContain('generation-section-8'))
    expect(scrolled).not.toContain('generation-section-7')
  })
})
