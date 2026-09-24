import { useState, useEffect } from 'react'
import type * as React from 'react'
import { Icon, Button } from '../../design-system'
import { createAssessment as requestCreateAssessment, GatewayError } from './api'
import { formatDayTime } from './format'
import type { AssessmentRow, WorkflowState } from './types'
import { useCaptureSession } from './useCaptureSession'
import {
  initialState,
  CAPTURE_ASSESSMENT,
  JURISDICTIONS,
  ROWS,
  CAT_ICON,
  SEV,
  STANDARDS,
  ENGINEERS,
  TITLES,
  PLAIN,
  EVIDENCE,
  OBS,
} from './demo-data'
export type AssessmentWorkflow = ReturnType<typeof useAssessmentWorkflow>
export function useAssessmentWorkflow(onSignOut: () => void) {
  const [state, updateState] = useState<WorkflowState>(() => structuredClone(initialState))
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [timeouts] = useState(() => new Set<ReturnType<typeof setTimeout>>())
  const capture = useCaptureSession(state.captureTarget.reference, state.screen === 'field')
  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      timeouts.delete(timer)
      callback()
    }, delay)
    timeouts.add(timer)
  }
  function setState(patch: Partial<WorkflowState>) {
    updateState((previous) => ({
      ...previous,
      ...patch,
    }))
  }
  useEffect(() => {
    const measure = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', measure)
    const timers = timeouts
    return () => {
      window.removeEventListener('resize', measure)
      timers.forEach(clearTimeout)
    }
  }, [timeouts])
  useEffect(() => {
    const timer = setInterval(
      () =>
        updateState((previous) => {
          if (!previous.running || previous.screen !== 'assessment' || previous.tab !== 'generate')
            return previous
          const gsecs = previous.gsecs.map((section) => ({
            ...section,
          }))
          const processing = gsecs.find((section) => section.st === 'processing')
          if (processing) {
            processing.p = Math.min(100, (processing.p || 0) + 18)
            if (processing.p === 100) processing.st = 'done'
            return {
              ...previous,
              gsecs,
            }
          }
          const queued = gsecs.find((section) => section.st === 'queued')
          if (queued) {
            queued.st = 'processing'
            queued.p = 8
            return {
              ...previous,
              gsecs,
            }
          }
          return {
            ...previous,
            running: false,
          }
        }),
      850,
    )
    const recorder = setInterval(
      () =>
        updateState((previous) =>
          previous.fRec
            ? {
                ...previous,
                fSecs: previous.fSecs + 1,
              }
            : previous,
        ),
      1000,
    )
    return () => {
      clearInterval(timer)
      clearInterval(recorder)
    }
  }, [])
  function toast(message: string, tone = 'success') {
    setState({
      toast: message,
      toastTone: tone || 'success',
    })
  }
  // The workspace always shows the demo assessment, so capture opened from it
  // targets that assessment.
  function navigate(screen: string): Partial<WorkflowState> {
    return screen === 'assessment' ? { screen, captureTarget: CAPTURE_ASSESSMENT } : { screen }
  }
  function addCreatedRow(row: AssessmentRow) {
    updateState((previous) => ({
      ...previous,
      createdRows: [row, ...previous.createdRows],
      screen: 'dashboard',
      cfBusy: false,
      cfErr: false,
    }))
  }
  function openItems() {
    const out = []
    if (!state.u3)
      out.push({
        id: 'u3',
        section: 's3',
        icon: 'triangle-alert',
        kindLabel: 'Unsupported claim',
        question: 'No source in the drafting set supports the 2021 hydraulic recalculation.',
        optionA: 'Remove the sentence',
        optionB: 'Attach the 2021 calculation sheet',
        label: 'Unsupported claim in 3.2 Sprinkler protection',
        where: '3.2 Sprinkler protection',
      })
    if (!state.u1)
      out.push({
        id: 'u1',
        section: 's4',
        icon: 'triangle-alert',
        kindLabel: 'Missing evidence',
        question: 'The 2023 pump test certificate is not in the document set.',
        optionA: 'Certificate exists — attach it',
        optionB: 'Not available — record as a finding',
        label: 'Pump test certificate not evidenced',
        where: '3.3 Water supplies',
      })
    if (!state.u2)
      out.push({
        id: 'u2',
        section: 's5',
        icon: 'git-compare-arrows',
        kindLabel: 'Conflicting sources',
        question:
          'Conveyor controller lead time conflicts between the site interview (14 weeks) and the 2023 report (8 weeks).',
        optionA: 'Use 14 weeks — site interview',
        optionB: 'Use 8 weeks — 2023 report',
        label: 'Conveyor lead time conflicts between sources',
        where: '4.0 Business interruption exposure',
      })
    return out
  }
  function liveSections() {
    return Object.keys(TITLES).filter((k) => !state.rejected[k])
  }
  function reviewedCount() {
    return liveSections().filter(
      (k) => state.secSt[k] === 'accepted' || state.secSt[k] === 'edited',
    ).length
  }
  function isBlocked() {
    if (!liveSections().length) return true
    return reviewedCount() < liveSections().length || openItems().length > 0
  }
  function chipStyle(on: boolean, tone: string) {
    return {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '44px',
      padding: '0 4px',
      borderRadius: '5px',
      fontFamily: 'inherit',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background 120ms cubic-bezier(.2,0,.2,1)',
      border: '1px solid ' + (on ? 'var(--status-' + tone + '-fg)' : 'var(--border-default)'),
      background: on ? 'var(--status-' + tone + '-bg)' : 'var(--surface-card)',
      color: on ? 'var(--status-' + tone + '-fg)' : 'var(--text-secondary)',
    } as React.CSSProperties
  }
  function modeStyle(on: boolean) {
    return {
      height: '46px',
      border: 'none',
      borderBottom: '2px solid ' + (on ? 'var(--action-primary)' : 'transparent'),
      background: 'transparent',
      fontFamily: 'inherit',
      fontSize: '16px',
      fontWeight: on ? '500' : '400',
      color: on ? 'var(--text-primary)' : 'var(--text-muted)',
      cursor: 'pointer',
      transition: 'color 120ms cubic-bezier(.2,0,.2,1)',
    } as React.CSSProperties
  }
  function userFooter() {
    return (
      <div className="user-footer">
        <span className="user-avatar">AR</span>
        <div>
          <strong>A. Rowe</strong>
          <small>Risk engineer</small>
        </div>
        <Button
          variant="ghost"
          size="sm"
          title="Sign out"
          aria-label="Sign out"
          onClick={onSignOut}
        >
          <Icon name="log-out" />
        </Button>
      </div>
    )
  }
  function renderVals() {
    const s = state
    const sc = s.screen,
      live = liveSections(),
      open = openItems()
    const isAssessment = sc === 'assessment'
    const w = viewportWidth
    const narrow = w < 1080
    const phone = w < 760

    /* capture session: name the assessment from the server when live */
    const liveCapture = capture.state?.status === 'live' ? capture.state : null
    const captureRef = liveCapture?.assessment.reference ?? s.captureTarget.reference
    const captureSite = liveCapture?.assessment.site?.name ?? s.captureTarget.site
    // The demo assessment keeps its sample observations; others start empty.
    const isDemoCapture = s.captureTarget.reference === CAPTURE_ASSESSMENT.reference
    const fieldRecent = isDemoCapture ? s.fRecent : (s.captureObs[s.captureTarget.reference] ?? [])
    const fieldSaved = isDemoCapture ? s.fSaved : fieldRecent.length

    /* nav */
    const navSections = [
      {
        label: 'Assessments',
        items: [
          {
            value: 'dashboard',
            label: 'Dashboard',
            icon: 'inbox',
            count: ROWS.length + s.createdRows.length,
          },
          {
            value: 'create',
            label: 'New assessment',
            icon: 'plus',
          },
          {
            value: 'field',
            label: 'Site observation',
            icon: 'camera',
            count: fieldSaved,
          },
        ],
      },
      {
        label: 'Open assessment',
        items: [
          {
            value: 'assessment',
            label: 'Tilbury Distribution Centre',
            icon: 'file-pen',
          },
        ],
      },
    ]

    /* dashboard rows */
    const rows = [...s.createdRows, ...ROWS]
    const q = s.q.trim().toLowerCase()
    const filtered = rows
      .filter((r) => {
        if (q && !(r.site + ' ' + r.client + ' ' + r.id).toLowerCase().includes(q)) return false
        if (s.fStatus !== 'All statuses' && r.status !== s.fStatus) return false
        if (s.fEng !== 'All engineers' && r.eng !== s.fEng) return false
        return true
      })
      .map((r) => {
        const n = r.live ? open.length : r.open || 0
        return {
          ...r,
          sevIcon: SEV[r.sev].icon,
          sevColor: SEV[r.sev].color,
          stackMeta: r.client + ' · ' + r.type + ' · ' + r.eng,
          hasOpen: n > 0,
          noOpen: n === 0,
          openLabel: n + (n === 1 ? ' open' : ' open'),
        }
      })

    /* generation */
    const GST: Record<
      string,
      {
        tone: string
        icon: string
        label: string
      }
    > = {
      done: {
        tone: 'low',
        icon: 'check',
        label: 'Drafted',
      },
      processing: {
        tone: 'ai',
        icon: 'sparkles',
        label: 'Drafting',
      },
      queued: {
        tone: 'neutral',
        icon: 'ellipsis',
        label: 'Queued',
      },
      insufficient: {
        tone: 'moderate',
        icon: 'triangle-alert',
        label: 'Insufficient evidence',
      },
      failed: {
        tone: 'critical',
        icon: 'octagon-alert',
        label: 'Failed',
      },
      stopped: {
        tone: 'neutral',
        icon: 'x',
        label: 'Stopped',
      },
      manual: {
        tone: 'info',
        icon: 'pencil',
        label: 'Yours to write',
      },
    }
    const gsecs = s.gsecs.map((g) => {
      const m = GST[g.st]
      return {
        ...g,
        tone: m.tone,
        icon: m.icon,
        label: m.label,
        isProcessing: g.st === 'processing',
        isInsufficient: g.st === 'insufficient',
        isFailed: g.st === 'failed',
        showConf: g.st === 'done',
        evLabel: g.ev + (g.ev === 1 ? ' source' : ' sources'),
        barStyle: {
          display: 'block',
          height: '100%',
          width: (g.p || 0) + '%',
          background: 'var(--ai-fg)',
          borderRadius: '2px',
          transition: 'width 260ms cubic-bezier(.2,0,.2,1)',
        } as React.CSSProperties,
      }
    })
    const doneCount = s.gsecs.filter((g) => g.st === 'done').length
    const attention = s.gsecs.filter(
      (g) => g.st === 'insufficient' || g.st === 'failed' || g.st === 'stopped',
    ).length

    /* review */
    const sel = s.sel
    const RST: Record<
      string,
      {
        icon: string
        color: string
      }
    > = {
      draft: {
        icon: 'sparkles',
        color: 'var(--icon-draft)',
      },
      edited: {
        icon: 'pencil',
        color: 'var(--text-secondary)',
      },
      accepted: {
        icon: 'circle-check',
        color: 'var(--icon-final)',
      },
      flagged: {
        icon: 'triangle-alert',
        color: 'var(--icon-signoff)',
      },
    }
    const railItems = Object.keys(TITLES).map((k) => {
      const rejected = !!s.rejected[k]
      const st = s.secSt[k] || 'draft'
      const active = k === sel
      const g = RST[st]
      return {
        id: k,
        n: TITLES[k].split(' ')[0],
        title: TITLES[k].split(' ').slice(1).join(' '),
        isRejected: rejected,
        notRejected: !rejected,
        icon: g.icon,
        iconColor: g.color,
        rowStyle: {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '9px 18px',
          cursor: 'pointer',
          opacity: rejected ? '.5' : '1',
          borderLeft: '2px solid ' + (active ? 'var(--action-primary)' : 'transparent'),
          background: active ? 'var(--surface-selected)' : 'transparent',
          transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
        } as React.CSSProperties,
      }
    })
    const selOpen = open.filter((o) => o.section === sel)
    const selRejected = !!s.rejected[sel]
    const claimFlagged = s.u3 === null
    const conflictFlagged = s.u2 === null
    const evidence = (EVIDENCE[sel] || []).map((e) => ({
      ...e,
      excerpt: e.excerpt || '',
      wrapStyle: {
        borderRadius: '5px',
        transition: 'box-shadow 120ms cubic-bezier(.2,0,.2,1)',
        boxShadow: s.activeCite === e.index ? 'var(--focus-ring)' : 'none',
      } as React.CSSProperties,
    }))

    /* export */
    const reviewed = reviewedCount()
    const blocked = isBlocked()
    const checklist = [
      {
        label: 'All sections reviewed',
        value: reviewed + ' of ' + live.length,
        ok: live.length > 0 && reviewed === live.length,
      },
      {
        label: 'No unresolved review items',
        value: open.length === 0 ? 'None' : open.length + ' open',
        ok: open.length === 0,
      },
      {
        label: 'Photographs captioned',
        value: '28 of 28',
        ok: true,
      },
      {
        label: 'Client and site details confirmed',
        value: 'Confirmed',
        ok: true,
      },
      {
        label: 'Applicable standards recorded',
        value: '3 documents',
        ok: true,
      },
    ].map((c) => ({
      ...c,
      icon: c.ok ? 'circle-check' : 'triangle-alert',
      color: c.ok ? 'var(--status-low-fg)' : 'var(--status-moderate-fg)',
      valueStyle: {
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        whiteSpace: 'nowrap',
        color: c.ok ? 'var(--status-low-fg)' : 'var(--status-moderate-fg)',
      } as React.CSSProperties,
    }))

    /* create form */
    const standards = STANDARDS.map((t) => ({
      ...t,
      on: s.cf.stds.includes(t.name),
    }))
    const engineers = ENGINEERS.map((e) => ({
      ...e,
      on: s.cf.engs.includes(e.name),
      isLead: s.cf.engs[0] === e.name,
    }))

    /* field */
    const waveBars = Array.from(
      {
        length: 26,
      },
      (_, i) => {
        const h = s.fRec ? 6 + ((i * 7 + s.fSecs * 5) % 34) : 4
        return {
          style: {
            display: 'block',
            width: '4px',
            borderRadius: '2px',
            height: h + 'px',
            background: s.fRec ? 'var(--ai-fg)' : 'var(--graphite-300)',
            transition: 'height 180ms cubic-bezier(.2,0,.2,1)',
          } as React.CSSProperties,
        }
      },
    )
    const mm = String(Math.floor(s.fSecs / 60)).padStart(2, '0')
    const ss = String(s.fSecs % 60).padStart(2, '0')
    return {
      /* chrome */
      navSections,
      navValue: isAssessment ? 'assessment' : sc,
      navFooter: userFooter(),
      showSideNav: !phone && !s.navCollapsed,
      showTopBar: phone,
      showHeaderMenu: !phone,
      toggleNav: () =>
        phone
          ? setState({
              navOpen: !s.navOpen,
            })
          : setState({
              navCollapsed: !s.navCollapsed,
            }),
      navOpen: !!s.navOpen,
      openNav: () =>
        setState({
          navOpen: true,
        }),
      closeNav: () =>
        setState({
          navOpen: false,
        }),
      goFromDrawer: (v: string) =>
        setState({
          ...navigate(v),
          navOpen: false,
          toast: null,
        }),
      wideTable: !narrow,
      stackTable: narrow,
      reviewWrapStyle: narrow
        ? ({
            display: 'flex',
            flexDirection: 'column',
            minHeight: '0',
            animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
          } as React.CSSProperties)
        : ({
            display: 'flex',
            height: '100%',
            minHeight: '0',
            animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
          } as React.CSSProperties),
      reviewRailStyle: narrow
        ? ({
            flex: '0 0 auto',
            width: '100%',
            background: 'var(--surface-card)',
            borderBottom: '1px solid var(--border-default)',
          } as React.CSSProperties)
        : ({
            flex: '0 0 auto',
            width: '264px',
            overflow: 'auto',
            background: 'var(--surface-card)',
            borderRight: '1px solid var(--border-default)',
          } as React.CSSProperties),
      reviewEvidenceStyle: narrow
        ? ({
            flex: '0 0 auto',
            width: '100%',
            background: 'var(--surface-card)',
            borderTop: '1px solid var(--border-default)',
          } as React.CSSProperties)
        : ({
            flex: '0 0 auto',
            width: '344px',
            overflow: 'auto',
            background: 'var(--surface-card)',
            borderLeft: '1px solid var(--border-default)',
          } as React.CSSProperties),
      go: (v: string) => {
        setState({
          ...navigate(v),
          toast: null,
        })
      },
      goDash: () =>
        setState({
          screen: 'dashboard',
        }),
      goCreate: () =>
        setState({
          screen: 'create',
          cfErr: false,
          cfServerError: null,
        }),
      goField: () =>
        setState({
          screen: 'field',
        }),
      goAssessment: () => setState(navigate('assessment')),
      goReview: () =>
        setState({
          tab: 'review',
        }),
      isDashboard: sc === 'dashboard',
      isCreate: sc === 'create',
      isField: sc === 'field',
      isAssessment,
      isOverview: isAssessment && s.tab === 'overview',
      isObservations: isAssessment && s.tab === 'observations',
      ovDrafted: s.gsecs.filter((x) => x.st === 'done').length + ' of ' + s.gsecs.length,
      fSaved: s.fSaved,
      goGenerate: () =>
        setState({
          tab: 'generate',
        }),
      ovFacts: [
        {
          label: 'Report',
          value: 'RPT-2026-0411',
        },
        {
          label: 'Site',
          value: 'Tilbury Distribution Centre, Ferry Lane, Tilbury RM18 7HR',
        },
        {
          label: 'Client',
          value: 'Northgate Logistics',
        },
        {
          label: 'Assessment type',
          value: 'Property risk survey',
        },
        {
          label: 'Site visit',
          value: '11 Apr 2026',
        },
        {
          label: 'Report due',
          value: '25 Apr 2026',
        },
        {
          label: 'Lead engineer',
          value: 'A. Rowe',
        },
      ],
      obsWide: !narrow,
      obsStack: narrow,
      obsList: s.fRecent.map((o, i) => {
        const open = s.obsOpen === i
        const sev = o.sev || 'low'
        const cols = narrow
          ? '36px minmax(0,1fr) 72px'
          : '40px minmax(0,1.4fr) minmax(0,1.1fr) minmax(0,2fr) 120px 84px'
        return {
          ...o,
          key: String(i),
          open,
          icon: CAT_ICON[o.cat] || 'circle-dot',
          color: 'var(--text-secondary)',
          chevron: open ? 'chevron-down' : 'chevron-right',
          clock: (o.time || '').split(' ').slice(-1)[0],
          sev,
          sevLabel: sev.charAt(0).toUpperCase() + sev.slice(1),
          detail: o.detail || o.text,
          media: (o.media || []).map((n) => ({
            name: n,
          })),
          hasAudio: !!o.audio,
          audioLabel: 'Audio note (' + (o.audio || '') + ')',
          hasStd: !!o.std,
          rowStyle: {
            display: 'grid',
            gridTemplateColumns: cols,
            alignItems: narrow ? 'flex-start' : 'center',
            gap: '12px',
            padding: '12px 16px',
            cursor: 'pointer',
            borderBottom: '1px solid var(--border-subtle)',
            transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
            background: open ? 'var(--surface-selected)' : 'var(--surface-card)',
          } as React.CSSProperties,
        }
      }),
      toggleObs: (e: React.MouseEvent<HTMLElement>) => {
        const k = Number(e.currentTarget.dataset.i)
        setState({
          obsOpen: s.obsOpen === k ? null : k,
        })
      },
      obsCountLabel: 'Showing 1–' + s.fRecent.length + ' of ' + s.fSaved + ' observations',
      obsNext: () => toast('Later observations are not loaded in this prototype.', 'info'),
      ovStandards: [
        {
          icon: 'book-marked',
          name: 'FM Global 2-0',
          detail: 'Installation of sprinkler systems',
        },
        {
          icon: 'book-marked',
          name: 'NFPA 13',
          detail: 'Standard for the installation of sprinkler systems',
        },
        {
          icon: 'file-text',
          name: 'Tilbury survey 2023',
          detail: 'Previous Marsh report, issued 14 Mar 2023',
        },
      ],
      isGenerate: isAssessment && s.tab === 'generate',
      isReview: isAssessment && s.tab === 'review',
      isExport: isAssessment && s.tab === 'export',
      eyebrow:
        sc === 'dashboard'
          ? 'Risk engineering'
          : sc === 'create'
            ? 'New assessment'
            : sc === 'field'
              ? 'On site'
              : 'Assessment workspace',
      title:
        sc === 'dashboard'
          ? 'Your assessments'
          : sc === 'create'
            ? 'Create assessment'
            : sc === 'field'
              ? 'Site observation'
              : 'Tilbury Distribution Centre',
      meta:
        sc === 'dashboard'
          ? rows.length + ' assessments · A. Rowe · Week of 11 Apr 2026'
          : sc === 'create'
            ? 'Opening an assessment creates the report record and its drafting set.'
            : sc === 'field'
              ? captureSite +
                ' · ' +
                captureRef +
                ' · ' +
                fieldSaved +
                (fieldSaved === 1 ? ' observation captured' : ' observations captured')
              : 'RPT-2026-0411 · Property risk survey · Assessed 11 Apr 2026 · Lead engineer A. Rowe',
      showSeverity: isAssessment,
      tab: s.tab,
      setTab: (v: string) =>
        setState({
          tab: v,
        }),
      tabItems: [
        {
          value: 'overview',
          label: 'Overview',
          icon: 'file-pen',
        },
        {
          value: 'observations',
          label: 'Observations',
          icon: 'camera',
          count: s.fSaved,
        },
        {
          value: 'generate',
          label: 'Report generation',
          icon: 'sparkles',
        },
        {
          value: 'review',
          label: 'Review',
          icon: 'user-round-search',
          count: live.length,
        },
        {
          value: 'export',
          label: 'Validation and export',
          icon: 'stamp',
          count: open.length,
        },
      ],
      toast: s.toast,
      toastTone: s.toastTone,
      clearToast: () =>
        setState({
          toast: null,
        }),
      openEvidenceSource: () =>
        toast('Source files are not connected in this demo. Excerpts are sample evidence.', 'info'),
      playSampleAudio: () => toast('Audio playback is not connected in this demo.', 'info'),
      showVersionHistory: () => toast('Version history is not connected in this demo.', 'info'),
      /* annotations */

      /* dashboard */
      q: s.q,
      setQ: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          q: e.target.value,
        }),
      fStatus: s.fStatus,
      setStatus: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          fStatus: e.target.value,
        }),
      fEng: s.fEng,
      setEng: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          fEng: e.target.value,
        }),
      statusOptions: ['All statuses', 'Draft', 'In review', 'Awaiting sign-off', 'Finalised'],
      engOptions: ['All engineers', 'A. Rowe', 'J. Okafor', 'M. Haas'],
      filteredRows: filtered,
      noResults: filtered.length === 0,
      resultLabel: filtered.length + ' of ' + rows.length + ' assessments',
      openTotal: open.length + 3,
      unfiled: 12,
      assignedCount: rows.filter((row) => row.eng === 'A. Rowe').length,
      onRow: (e: React.MouseEvent<HTMLElement>) => {
        const id = e.currentTarget.dataset.id
        const created = s.createdRows.find((row) => row.id === id)
        if (id === CAPTURE_ASSESSMENT.reference)
          setState({
            ...navigate('assessment'),
            toast: null,
          })
        else if (created?.persisted)
          // Nothing is drafted for a new assessment yet, so it opens on capture.
          setState({
            screen: 'field',
            toast: null,
            captureTarget: { reference: created.id, site: created.site },
          })
        else if (created) toast(id + ' exists only in this demo, so it cannot be opened.', 'info')
        else toast('This prototype opens RPT-2026-0411. ' + id + ' is shown for context.', 'info')
      },
      /* create */
      cfSite: s.cf.site,
      cfClient: s.cf.client,
      cfAddr: s.cf.addr,
      cfRef: s.cf.ref,
      cfType: s.cf.type,
      cfSurvey: s.cf.survey,
      cfDate: s.cf.date,
      cfDue: s.cf.due,
      errSite: s.cfErr && !s.cf.site.trim() ? 'Site name is required' : '',
      errClient: s.cfErr && !s.cf.client.trim() ? 'Client is required' : '',
      hasCfError: s.cfErr && (!s.cf.site.trim() || !s.cf.client.trim()),
      setCfSite: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            site: e.target.value,
          },
        }),
      setCfClient: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            client: e.target.value,
          },
        }),
      setCfAddr: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            addr: e.target.value,
          },
        }),
      setCfRef: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            ref: e.target.value,
          },
        }),
      setCfType: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            type: e.target.value,
          },
        }),
      setCfSurvey: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            survey: e.target.value,
          },
        }),
      setCfDate: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            date: e.target.value,
          },
        }),
      setCfDue: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            due: e.target.value,
          },
        }),
      cfJurisdiction: s.cf.jurisdiction,
      setCfJurisdiction: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            jurisdiction: e.target.value,
          },
        }),
      jurisdictionOptions: JURISDICTIONS,
      cfBusy: s.cfBusy,
      cfServerError: s.cfServerError,
      createLabel: s.cfBusy ? 'Creating assessment…' : 'Create assessment',
      facilityOptions: [
        'Distribution warehouse',
        'Cold store',
        'Chemical plant',
        'Paper mill',
        'Port terminal',
        'Office and data centre',
      ],
      surveyOptions: [
        'Property risk survey',
        'Follow-up visit',
        'Business interruption',
        'Natural hazard review',
      ],
      standards,
      engineers,
      stdCountLabel: s.cf.stds.length + ' of 6 selected',
      toggleStd: (v: string) => {
        const has = s.cf.stds.includes(v)
        setState({
          cf: {
            ...s.cf,
            stds: has ? s.cf.stds.filter((x) => x !== v) : s.cf.stds.concat([v]),
          },
        })
      },
      toggleEng: (v: string) => {
        const has = s.cf.engs.includes(v)
        setState({
          cf: {
            ...s.cf,
            engs: has ? s.cf.engs.filter((x) => x !== v) : s.cf.engs.concat([v]),
          },
        })
      },
      createAssessment: async () => {
        if (s.cfBusy) return
        if (!s.cf.site.trim() || !s.cf.client.trim()) {
          setState({
            cfErr: true,
          })
          return
        }
        setState({ cfBusy: true, cfErr: false, cfServerError: null })
        const date = s.cf.date
          ? new Date(s.cf.date + 'T00:00:00').toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : 'Unscheduled'
        try {
          const created = await requestCreateAssessment({
            site: {
              name: s.cf.site,
              address: s.cf.addr,
              jurisdiction: s.cf.jurisdiction,
              facilityType: s.cf.type,
            },
            client: s.cf.client,
            policyReference: s.cf.ref,
            surveyType: s.cf.survey,
            siteVisitDate: s.cf.date,
            reportDueDate: s.cf.due,
            standards: s.cf.stds,
            engineers: s.cf.engs,
          })
          addCreatedRow({
            id: created.reference,
            site: created.site.name,
            client: created.client,
            type: created.surveyType,
            date,
            eng: created.engineers[0] ?? 'Unassigned',
            status: 'Draft',
            sev: 'low',
            open: 0,
            persisted: true,
          })
          toast(
            created.reference +
              ' created for ' +
              created.site.name +
              '. Open it from the list to capture observations on site.',
          )
        } catch (error: unknown) {
          if (error instanceof GatewayError && error.status === null) {
            // Keep the demo usable without the gateway, and say nothing was saved.
            const id = `RPT-2026-${String(416 + s.createdRows.length).padStart(4, '0')}`
            addCreatedRow({
              id,
              site: s.cf.site,
              client: s.cf.client,
              type: s.cf.survey,
              date,
              eng: s.cf.engs[0] || 'Unassigned',
              status: 'Draft',
              sev: 'low',
              open: 0,
            })
            toast(
              'The gateway could not be reached, so ' +
                id +
                ' exists only in this demo and is not saved.',
              'warning',
            )
            return
          }
          const problems = error instanceof GatewayError ? Object.values(error.fields) : []
          setState({
            cfBusy: false,
            cfServerError: problems.length
              ? problems.join(' ') + ' Correct the details above, then create the assessment again.'
              : (error instanceof Error ? error.message : 'The assessment could not be created.') +
                ' Try again, or check the gateway logs if it keeps failing.',
          })
        }
      },
      /* field */
      capture: capture.state,
      retryCapture: capture.retry,
      captureRef,
      fSavedLabel: fieldSaved + ' saved',
      showWorkspaceLink: isDemoCapture,
      fieldEmptyLabel: 'No observations captured for ' + captureRef + ' yet.',
      isNoteMode: s.fMode === 'note',
      isVoiceMode: s.fMode === 'voice',
      isPhotoMode: s.fMode === 'photo',
      tabNoteStyle: modeStyle(s.fMode === 'note'),
      tabVoiceStyle: modeStyle(s.fMode === 'voice'),
      tabPhotoStyle: modeStyle(s.fMode === 'photo'),
      modeNote: () =>
        setState({
          fMode: 'note',
        }),
      modeVoice: () =>
        setState({
          fMode: 'voice',
        }),
      modePhoto: () =>
        setState({
          fMode: 'photo',
        }),
      fNote: s.fNote,
      setFNote: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          fNote: e.target.value,
        }),
      waveBars,
      fClock: mm + ':' + ss,
      recLabel: s.fRec
        ? 'Stop recording'
        : s.fTransBusy
          ? 'Loading transcript…'
          : 'Start recording',
      recHint: s.fRec
        ? 'Simulating recording; your microphone is not accessed.'
        : s.fTransBusy
          ? 'Loading the sample transcript.'
          : 'Demo recording produces a sample transcript; no audio is captured.',
      recStyle: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        width: '100%',
        height: '46px',
        borderRadius: '5px',
        border: '1px solid ' + (s.fRec ? 'var(--action-danger)' : 'var(--action-primary)'),
        background: s.fRec ? 'var(--action-danger)' : 'var(--action-primary)',
        color: '#fff',
        fontFamily: 'inherit',
        fontSize: '16px',
        fontWeight: '500',
        cursor: 'pointer',
      } as React.CSSProperties,
      toggleRec: () => {
        if (s.fRec) {
          setState({
            fRec: false,
            fTransBusy: true,
          })
          later(
            () =>
              setState({
                fTransBusy: false,
                fTrans: true,
              }),
            1200,
          )
        } else
          setState({
            fRec: true,
            fSecs: 0,
            fTrans: false,
          })
      },
      hasTranscript: s.fTrans,
      fTranscriptText:
        'Head spacing looks unchanged from the 2023 layout, but the racking is new and sits directly under two heads in the north aisle of Bay 3.',
      transcriptToNote: () =>
        setState({
          fMode: 'note',
          fTrans: false,
          fNote:
            'Head spacing looks unchanged from the 2023 layout, but the racking is new and sits directly under two heads in the north aisle of Bay 3.',
        }),
      fPhotos: s.fPhotos,
      photoHint:
        s.fPhotos.length === 0
          ? 'No photographs attached to this observation yet.'
          : s.fPhotos.length +
            ' photograph' +
            (s.fPhotos.length === 1 ? '' : 's') +
            ' attached. Each is captioned with the location below.',
      takePhoto: () =>
        setState({
          fPhotos: s.fPhotos.concat([
            {
              name: 'IMG_0' + (460 + s.fPhotos.length) + '.jpg',
            },
          ]),
        }),
      fArea: s.fArea,
      setFArea: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          fArea: e.target.value,
        }),
      fCat: s.fCat,
      setFCat: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          fCat: e.target.value,
        }),
      areaOptions: [
        'Bay 3 — north aisle',
        'Bay 1 — despatch',
        'Pump house',
        'Office annexe',
        'External yard',
        'Sprinkler valve room',
      ],
      catOptions: [
        'Fire protection',
        'Water supplies',
        'Business interruption',
        'Construction',
        'Electrical',
        'Security',
        'Natural hazards',
        'Housekeeping',
      ],
      sevCriticalStyle: chipStyle(s.fSev === 'critical', 'critical'),
      sevHighStyle: chipStyle(s.fSev === 'high', 'high'),
      sevModerateStyle: chipStyle(s.fSev === 'moderate', 'moderate'),
      sevLowStyle: chipStyle(s.fSev === 'low', 'low'),
      setFSev: (e: React.MouseEvent<HTMLElement>) =>
        setState({
          fSev: e.currentTarget.dataset.v || 'low',
        }),
      fStd: s.fStd,
      setFStd: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          fStd: e.target.value,
        }),
      fToast: s.fToast,
      fRecent: fieldRecent,
      saveObservation: () => {
        const text =
          s.fNote.trim() ||
          (s.fTrans
            ? 'Head spacing looks unchanged from the 2023 layout, but the racking is new and sits directly under two heads in the north aisle of Bay 3.'
            : '') ||
          (s.fPhotos.length ? s.fPhotos.length + ' photograph(s) captured at ' + s.fArea + '.' : '')
        if (!text) {
          setState({
            fToast: 'Add a note, recording or photograph first.',
          })
          return
        }
        const entry = {
          icon: s.fMode === 'photo' ? 'camera' : s.fMode === 'voice' ? 'mic' : 'sticky-note',
          color: s.fMode === 'photo' ? '#4f9aee' : s.fMode === 'voice' ? '#8f7dff' : '#f9ac10',
          cat: s.fCat,
          time: isDemoCapture ? '11 Apr 15:0' + (s.fSaved - 27) : formatDayTime(new Date()),
          text,
          area: s.fArea,
          sev: s.fSev,
          std: s.fStd,
          media: s.fPhotos.map((p) => p.name),
          detail: text,
        }
        const reference = s.captureTarget.reference
        setState({
          ...(isDemoCapture
            ? { fRecent: [entry].concat(s.fRecent), fSaved: s.fSaved + 1 }
            : { captureObs: { ...s.captureObs, [reference]: [entry].concat(fieldRecent) } }),
          fNote: '',
          fPhotos: [],
          fTrans: false,
          fToast: 'Observation added to ' + reference + '. It is kept in this demo only.',
        })
        later(
          () =>
            setState({
              fToast: null,
            }),
          3200,
        )
      },
      /* generation */
      gsecs,
      running: s.running,
      notRunning: !s.running,
      genPercent: Math.round((doneCount / 7) * 100),
      genProgressLabel: doneCount + ' of 7 sections drafted',
      genCalloutTitle: s.running ? 'Drafting in progress' : 'Drafting paused',
      genCalloutBody: s.running
        ? 'Drafted from 28 site observations, 4 past reports and 11 external standards. Sections appear for review as each one completes.'
        : 'Sections already drafted are kept. Resume drafting to continue from the first section that did not complete.',
      genFootnote:
        attention > 0
          ? doneCount + ' of 7 sections drafted · ' + attention + ' need attention before review'
          : doneCount + ' of 7 sections drafted · nothing outstanding in drafting',
      askStop: () =>
        setState({
          stopOpen: true,
        }),
      closeStop: () =>
        setState({
          stopOpen: false,
        }),
      stopOpen: s.stopOpen,
      stopDescription:
        doneCount +
        ' of 7 sections are already drafted and will be kept. Sections still drafting or queued will stop where they are, and you can resume from there.',
      stopFooter: (
        <div
          style={{
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            type={'button'}
            onClick={() =>
              setState({
                stopOpen: false,
              })
            }
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 5,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              color: 'var(--text-body)',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {'Keep drafting'}
          </button>
          <button
            type={'button'}
            onClick={() => stopGen()}
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 5,
              border: '1px solid var(--action-danger)',
              background: 'var(--action-danger)',
              color: '#fff',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {'Stop generation'}
          </button>
        </div>
      ),
      resumeGen: () => {
        const g = s.gsecs.map((x) => ({
          ...x,
        }))
        g.forEach((x) => {
          if (x.st === 'stopped') x.st = 'queued'
        })
        setState({
          gsecs: g,
          running: true,
          toast: null,
        })
      },
      retrySection: () => {
        const g = s.gsecs.map((x) => ({
          ...x,
        }))
        const f = g.find((x) => x.st === 'failed')
        if (f) {
          f.st = 'queued'
        }
        setState({
          gsecs: g,
          running: true,
        })
        toast('Simulating a retry of 4.0 Business interruption exposure.', 'info')
      },
      useCached: () => {
        const g = s.gsecs.map((x) => ({
          ...x,
        }))
        const f = g.find((x) => x.st === 'failed')
        if (f) {
          f.st = 'done'
          f.conf = 'medium'
        }
        setState({
          gsecs: g,
        })
        toast(
          "4.0 drafted from the cached standards copy of 08 Apr. The cache date is recorded in the section's sources.",
          'warning',
        )
      },
      draftManually: () => {
        const g = s.gsecs.map((x) => ({
          ...x,
        }))
        const f = g.find((x) => x.st === 'insufficient')
        if (f) f.st = 'manual'
        setState({
          gsecs: g,
          sel: 's4',
          tab: 'review',
          editing: true,
          draft: '',
        })
        toast('3.3 Water supplies is yours to write. Nothing has been drafted for it.', 'info')
      },
      /* review */
      railItems,
      selectSection: (e: React.MouseEvent<HTMLElement>) =>
        setState({
          sel: e.currentTarget.dataset.id || 's3',
          editing: false,
          activeCite: null,
        }),
      reviewPercent: Math.round((reviewed / Math.max(1, live.length)) * 100),
      reviewLabel: reviewed + ' of ' + live.length + ' sections reviewed',
      selEyebrow:
        TITLES[sel] +
        ' · ' +
        (s.secSt[sel] === 'accepted'
          ? 'accepted'
          : s.secSt[sel] === 'edited'
            ? 'edited by you'
            : 'awaiting your review'),
      selHeading: TITLES[sel],
      selStatus: selOpen.length > 0 ? 'flagged' : s.secSt[sel] || 'draft',
      selConf: sel === 's4' ? 'low' : sel === 's5' ? 'medium' : 'high',
      selEvCount: (EVIDENCE[sel] || []).length,
      selIsRejected: selRejected,
      selShowBlock: !selRejected,
      rejectedLabel: TITLES[sel] + ' was rejected and is excluded from the report.',
      acceptSection: () => {
        if (selOpen.length > 0) {
          toast(
            'Resolve the open review item in ' + TITLES[sel] + ' before accepting it.',
            'warning',
          )
          return
        }
        setState({
          secSt: {
            ...s.secSt,
            [sel]: 'accepted',
          },
        })
        toast(TITLES[sel] + ' accepted. The passage is now recorded as yours.')
      },
      startEdit: () =>
        setState({
          editing: true,
          draft: s.bodyOv[sel] || PLAIN[sel],
        }),
      cancelEdit: () =>
        setState({
          editing: false,
        }),
      saveEdit: () => {
        setState({
          editing: false,
          bodyOv: {
            ...s.bodyOv,
            [sel]: s.draft,
          },
          secSt: {
            ...s.secSt,
            [sel]: 'edited',
          },
        })
        toast(TITLES[sel] + ' updated. The section is recorded as written by you.')
      },
      editing: s.editing,
      draft: s.draft,
      setDraft: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          draft: e.target.value,
        }),
      showOverride: !s.editing && !!s.bodyOv[sel],
      showProse: !s.editing && !s.bodyOv[sel],
      selBodyText: s.bodyOv[sel] || '',
      is_s1: sel === 's1',
      is_s2: sel === 's2',
      is_s3g: sel === 's3g',
      is_s3: sel === 's3',
      is_s4: sel === 's4',
      is_s5: sel === 's5',
      is_s6: sel === 's6',
      rejectSection: () => {
        const order = Object.keys(TITLES)
        const next = order.find((k) => k !== sel && !s.rejected[k]) || sel
        setState({
          rejected: {
            ...s.rejected,
            [sel]: true,
          },
          sel: next,
          editing: false,
        })
        toast(TITLES[sel] + ' rejected and removed from the report.', 'warning')
      },
      undoReject: () => {
        const r = {
          ...s.rejected,
        }
        delete r[sel]
        setState({
          rejected: r,
        })
        toast(TITLES[sel] + ' restored to the report.')
      },
      prevSection: () => {
        const order = Object.keys(TITLES)
        const i = order.indexOf(sel)
        setState({
          sel: order[Math.max(0, i - 1)],
          editing: false,
        })
      },
      nextSection: () => {
        const order = Object.keys(TITLES)
        const i = order.indexOf(sel)
        setState({
          sel: order[Math.min(order.length - 1, i + 1)],
          editing: false,
        })
      },
      focusEvidence: () =>
        toast(
          (EVIDENCE[sel] || []).length +
            ' sources behind ' +
            TITLES[sel] +
            ' are listed in the evidence panel.',
          'info',
        ),
      onProse: (e: React.MouseEvent<HTMLElement>) => {
        const c = e.target instanceof HTMLElement && e.target.dataset.cite
        if (c)
          setState({
            activeCite: Number(c),
          })
      },
      claimVisible: s.u3 !== 'removed',
      claimTone: s.u3 ? 'neutral' : 'moderate',
      claimIcon: s.u3 ? 'check' : 'triangle-alert',
      claimLabel: s.u3 === 'cited' ? 'Source attached' : 'Unsupported claim',
      claimStyle: claimFlagged
        ? ({
            borderBottom: '2px solid var(--status-moderate-fg)',
            background: 'var(--status-moderate-bg)',
            padding: '1px 2px',
          } as React.CSSProperties)
        : ({
            borderBottom: 'none',
          } as React.CSSProperties),
      conflictTone: s.u2 ? 'neutral' : 'moderate',
      conflictIcon: s.u2 ? 'check' : 'git-compare-arrows',
      conflictLabel: s.u2
        ? s.u2 === '8'
          ? 'Source chosen — 2023 report'
          : 'Source chosen — site interview'
        : 'Conflicting sources',
      conflictStyle: conflictFlagged
        ? ({
            borderBottom: '2px solid var(--status-moderate-fg)',
            background: 'var(--status-moderate-bg)',
            padding: '1px 2px',
          } as React.CSSProperties)
        : ({
            borderBottom: 'none',
          } as React.CSSProperties),
      leadTime: s.u2 === '8' ? '8 weeks' : '14 weeks',
      selOpenItems: selOpen,
      hasSelOpenItems: selOpen.length > 0,
      resolveItem: (e: React.MouseEvent<HTMLElement>) => {
        const id = e.currentTarget.dataset.item,
          ch = e.currentTarget.dataset.choice
        if (id === 'u3') {
          setState({
            u3: ch === 'a' ? 'removed' : 'cited',
          })
          toast(
            ch === 'a'
              ? 'Unsupported sentence removed from 3.2 Sprinkler protection.'
              : '2021 calculation sheet attached as source 6. The claim is now supported.',
          )
        } else if (id === 'u1') {
          setState({
            u1: ch === 'a' ? 'attached' : 'finding',
          })
          toast(
            ch === 'a'
              ? 'Pump test certificate attached to 3.3 Water supplies.'
              : 'Recorded as a finding: pump test certificate not evidenced at the time of survey.',
          )
        } else {
          setState({
            u2: ch === 'a' ? '14' : '8',
          })
          toast(
            ch === 'a'
              ? 'Lead time set to 14 weeks from the site interview. The passage has been rewritten.'
              : 'Lead time set to 8 weeks from the 2023 report. The passage has been rewritten.',
          )
        }
      },
      selEvidence: evidence,
      selEvLabel: evidence.length + ' items',
      pickEvidence: (e: React.MouseEvent<HTMLElement>) =>
        setState({
          activeCite: Number(e.currentTarget.dataset.i),
        }),
      selObservations: OBS[sel] || [],
      /* export */
      checklist,
      blocked,
      notBlocked: !blocked,
      blockTitle:
        'Export blocked — ' + checklist.filter((c) => !c.ok).length + ' checks outstanding',
      blockBody:
        'A report cannot be issued while sections are unreviewed or review items are open. ' +
        (live.length - reviewed) +
        ' sections await your review and ' +
        open.length +
        ' review items are unresolved.',
      outstanding: open,
      noOutstanding: open.length === 0,
      outstandingLabel: open.length === 0 ? 'None' : open.length + ' open',
      jumpToSection: (e: React.MouseEvent<HTMLElement>) => {
        const id = e.currentTarget.dataset.sec
        if (!id) return
        setState({
          tab: 'review',
          sel: id,
          editing: false,
        })
      },
      isDocx: s.fmt === 'DOCX',
      isPdf: s.fmt === 'PDF',
      pickDocx: () =>
        setState({
          fmt: 'DOCX',
        }),
      pickPdf: () =>
        setState({
          fmt: 'PDF',
        }),
      optCite: s.optCite,
      optPhotos: s.optPhotos,
      optIdx: s.optIdx,
      setOptCite: (v: boolean) =>
        setState({
          optCite: v,
        }),
      setOptPhotos: (v: boolean) =>
        setState({
          optPhotos: v,
        }),
      setOptIdx: (v: boolean) =>
        setState({
          optIdx: v,
        }),
      exportLabel: 'Export as ' + s.fmt,
      exportHint: blocked
        ? 'Enabled once the checklist passes.'
        : 'Demo only. No file is generated and no sign-off is recorded.',
      askExport: () => {
        if (!isBlocked())
          setState({
            exportOpen: true,
          })
      },
      closeExport: () =>
        setState({
          exportOpen: false,
        }),
      exportOpen: s.exportOpen,
      exportDialogTitle: 'Export RPT-2026-0411 as ' + s.fmt + '?',
      exportDialogBody:
        live.length +
        ' sections selected. This simulates export only: no file is generated, no report is issued and no sign-off is recorded.',
      exportFooter: (
        <div
          style={{
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            type={'button'}
            onClick={() =>
              setState({
                exportOpen: false,
              })
            }
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 5,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              color: 'var(--text-body)',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {'Cancel'}
          </button>
          <button
            type={'button'}
            onClick={() => {
              setState({
                exportOpen: false,
                screen: 'dashboard',
              })
              toast('Demo export complete. No file was generated or issued.')
            }}
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 5,
              border: '1px solid var(--action-primary)',
              background: 'var(--action-primary)',
              color: '#fff',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {'Simulate export'}
          </button>
        </div>
      ),
      wordCount: '7 sections · 4,180 words · 28 photographs',
    }
  }
  function stopGen() {
    const g = state.gsecs.map((x) => ({
      ...x,
    }))
    g.forEach((x) => {
      if (x.st === 'processing' || x.st === 'queued') x.st = 'stopped'
    })
    setState({
      gsecs: g,
      running: false,
      stopOpen: false,
    })
    toast('Generation stopped. Drafted sections are kept and you can resume.', 'warning')
  }
  return renderVals()
}
