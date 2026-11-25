import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  IconRegistry,
  NavDrawer,
  PhoneBar,
  SideNav,
  Tabs,
  Toaster,
  TopBar,
} from '../../design-system'
import type { Session } from '../auth/api'
import { can } from '../auth/access'
import { ActivityButton } from '../background-work/components/ActivityButton'
import { NotificationBell } from '../notifications/NotificationBell'
import { useNotificationCounts } from '../notifications/useNotificationCounts'
import { Inbox } from '../inbox/screens/Inbox'
import {
  assessmentOpen,
  assessmentPlace,
  assessmentsStale,
  type AssessmentPlace,
} from './openAssessment'
import type { AssessmentWorkflow } from './useAssessmentWorkflow'
import { guardLeave } from './leaveGuard'
import { ScreenMotion } from './ScreenMotion'
import { AssessmentActions } from './components/AssessmentActions'
import { siteWalkReview } from '../site-walk/openReview'
import { DetailsPanel } from '../marshbot/components/DetailsPanel'
import './workflow.css'
import { Dashboard } from './screens/Dashboard'
import { NewAssessment } from '../new-assessment/screens/NewAssessment'
import { SiteObservation } from './screens/SiteObservation'
import { Overview } from './screens/Overview'
import { Checklist } from './screens/Checklist'
import { Observations } from './screens/Observations'
import { DraftingSteps } from './screens/DraftingSteps'
import { ReviewWorkspace } from './screens/ReviewWorkspace'
import { ReportExport } from './screens/ReportExport'
import { ComparisonTab } from './comparison/ComparisonTab'
import { Photos } from './screens/Photos'
import { Scans } from './screens/Scans'
import { Recordings } from './screens/Recordings'
import { WorkspaceState } from './components/WorkspaceState'
import { UserAccounts } from '../accounts/UserAccounts'
import { Settings } from '../settings/Settings'
import { ClientList } from '../clients/ClientList'
import { ClientPage } from '../clients/ClientPage'
import type { ItemLink } from '../marshbot/types'
import { Calendar } from '../calendar/screens/Calendar'
import { KnowledgeBase } from '../knowledge-base/KnowledgeBase'
// Loaded on first open: the chat screen brings OpenUI and the usage screen
// brings the chart library, which every other screen can skip.
const KnowledgeAssistant = lazy(() =>
  import('../chat/screens/KnowledgeAssistant').then((m) => ({ default: m.KnowledgeAssistant })),
)
const UsageCosts = lazy(() =>
  import('../usage/screens/UsageCosts').then((m) => ({ default: m.UsageCosts })),
)
import { AccessDenied } from '../auth/AccessDenied'
import marshLogo from '../../assets/marsh-logo.png'
import marshMark from '../../assets/marsh-m.png'

export function AssessmentApp({ v, session }: { v: AssessmentWorkflow; session: Session }) {
  const { counts } = useNotificationCounts()
  // The Inbox's red count (F-10) rides on its sidebar item: a number, a dot on the rail and
  // the phone menu, and the words a screen reader hears.
  const inboxTodo = counts.inboxTodo
  const navSections = v.navSections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.value === 'inbox'
        ? { ...item, count: inboxTodo, countLabel: `${inboxTodo} to do` }
        : item,
    ),
  }))
  // The open assessment's reference once it is on the work list. Until then the workspace and
  // capture show WorkspaceState (loading, failed or not on the list) instead of their screens.
  const reference = v.workspaceGate ? null : v.liveReference
  const captureOnPhone = v.isField && v.phone && !v.routeBlocked && !!reference
  // The assessment's Details panel (AS-06 board 06), from the header or MarshBot's client card.
  const [detailsOpen, setDetailsOpen] = useState(false)
  const openDetails = v.liveRecord ? () => setDetailsOpen(true) : undefined
  // A MarshBot link's place in the tab it opened (a checklist area, a report section), kept
  // while that tab stays open so it opens there; leaving the tab forgets it.
  const [goTo, setGoTo] = useState<ItemLink | null>(null)
  if (goTo && v.tab !== goTo.tab) setGoTo(null)
  // Going somewhere else asks first while the document editor has unsaved
  // changes (RV-08 AC14); choosing where you already are does not.
  const leave = (staying: boolean, go: () => void) => (staying ? go() : guardLeave(go))
  // The "site walk ready" notification opens that assessment's Observations tab;
  // Observations then opens the review (site-walk/openReview.ts).
  useEffect(() => {
    // Through the leave guard, like the tabs: an unsaved document or proposal asks first.
    const open = (e: Event) =>
      guardLeave(() =>
        v.openObservationsOf((e as CustomEvent<{ reference: string }>).detail.reference),
      )
    window.addEventListener(siteWalkReview.event, open)
    // An assigned assessment's Inbox row opens its Overview, the same way.
    const openOverview = (e: Event) =>
      guardLeave(() => v.openOverviewOf((e as CustomEvent<{ reference: string }>).detail.reference))
    window.addEventListener(assessmentOpen.event, openOverview)
    // An activity row (F-11) opens an observation, or drafting, the same way.
    const openPlace = (e: Event) => {
      const { reference, ...place } = (e as CustomEvent<{ reference: string } & AssessmentPlace>)
        .detail
      guardLeave(() => v.openPlaceOf(reference, place))
    }
    window.addEventListener(assessmentPlace.event, openPlace)
    window.addEventListener(assessmentsStale.event, v.refreshList)
    return () => {
      window.removeEventListener(assessmentsStale.event, v.refreshList)
      window.removeEventListener(siteWalkReview.event, open)
      window.removeEventListener(assessmentOpen.event, openOverview)
      window.removeEventListener(assessmentPlace.event, openPlace)
    }
  })
  // Each screen opens at the top, not where the last one was scrolled to. A
  // layout effect, so a screen that scrolls itself on opening (the
  // Observations tab back from capture, the document editor) still does,
  // from its own effects, afterwards.
  const scroller = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [v.viewKey])
  // Screen changes (R9 · 3): siblings fade, going deeper slides in from the right, going
  // back from the left. The screen's own key leaves out the tab, so tab changes stay still.
  const screenKey = v.viewKey
    .split('|')
    .filter((_, i) => i !== 1)
    .join('|')
  const depth = v.isClient ? 1 : v.isCreate || v.isAssessment || v.isField ? 2 : 0
  // Desktop has no phone bar, so the bell and activity sit in each page's own top bar.
  const desktopBell = !v.showTopBar && (
    <>
      <ActivityButton />
      <NotificationBell />
    </>
  )
  // Screens that draw their own TopBar; the shell draws it for the rest (the assessment
  // workspace and capture, the chat).
  const selfHeaded =
    !v.routeBlocked &&
    (v.isClient ||
      v.isClients ||
      v.isCalendar ||
      v.isDashboard ||
      v.isInbox ||
      v.isSettings ||
      v.isKnowledge ||
      v.isUsage ||
      v.isUsers ||
      v.isCreate)
  const inWorkspace = (!!v.isAssessment || !!v.isField) && !v.routeBlocked && !!reference
  return (
    <>
      <ScreenMotion screenKey={screenKey} depth={depth} main={scroller} />
      {/* data-sidenav lets fixed overlays centre on the content, not the window. */}
      <div
        className="workflow"
        data-sidenav={v.showSideNav ? (v.navCollapsed ? 'rail' : 'open') : undefined}
      >
        <div className="workflow-frame">
          <div style={{ display: 'flex', height: '100%' }}>
            {/* Collapsing leaves an icon rail (CP-23), never a hidden sidebar. */}
            {!!v.showSideNav && (
              <SideNav
                logoSrc={marshLogo}
                subtitle="Risk Report Generator"
                markSrc={marshMark}
                sections={navSections}
                value={v.navValue}
                onChange={(to: string) => leave(to === v.navValue, () => v.go(to))}
                footer={v.navFooter}
                collapsed={v.navCollapsed}
                onToggleCollapsed={v.toggleNav}
              />
            )}
            <NavDrawer open={v.navOpen} onClose={v.closeNav}>
              <SideNav
                logoSrc={marshLogo}
                subtitle="Risk Report Generator"
                sections={navSections}
                value={v.navValue}
                onChange={(to: string) => leave(to === v.navValue, () => v.goFromDrawer(to))}
                footer={v.navFooter}
                onToggleCollapsed={v.closeNav}
                toggleLabel="Close navigation"
              />
            </NavDrawer>
            <div style={{ flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column' }}>
              {/* Phone: one navy bar. Capture is drilled into, so ← replaces the menu. */}
              {!!v.showTopBar && (
                <PhoneBar
                  logoSrc={marshLogo}
                  onMenu={v.toggleNav}
                  alert={{ count: inboxTodo, label: `${inboxTodo} to do in Inbox` }}
                  bell={
                    <>
                      <ActivityButton tone="dark" />
                      <NotificationBell tone="dark" />
                    </>
                  }
                  back={
                    captureOnPhone
                      ? {
                          label: v.proposalCapture ? 'Back to site walk' : 'Back to observations',
                          title: 'New Observation',
                          onClick: v.leaveCapture,
                          // F-12: the same tag as the desktop header's Back (SiteObservation.tsx).
                          walk: 'new-observation.back',
                        }
                      : undefined
                  }
                />
              )}

              {/* Capture keeps the workspace's header and tabs. On a phone the
                  top bar stands in for them, leaving the screen to the form. */}
              {!captureOnPhone && !selfHeaded && (
                <TopBar
                  // On a phone the title takes the row, so the actions wrap under it.
                  stack={inWorkspace}
                  // Opened from a client's page: Back returns there, on the tab it was opened
                  // from (CP-29); from the calendar, to the calendar (CP-60). Leaving the
                  // document editor asks first.
                  back={
                    v.backTo && !v.routeBlocked
                      ? { label: v.backTo.label, onClick: () => guardLeave(v.backTo!.onClick) }
                      : undefined
                  }
                  eyebrow={v.phone ? undefined : v.eyebrow}
                  title={
                    v.routeBlocked
                      ? 'Access restricted'
                      : v.workspaceGate === 'missing'
                        ? 'Assessment not found'
                        : v.title
                  }
                  helper={v.routeBlocked ? undefined : v.meta || undefined}
                  action={
                    inWorkspace ? (
                      <span className="ws-actions">
                        {/* Restore stays visible: it is the one thing to do with an
                            archived assessment. */}
                        {v.canRestore && (
                          <Button
                            pill
                            variant="secondary"
                            iconLeft={IconRegistry.action.reinstate}
                            onClick={v.restoreAssessment}
                            disabled={v.archiveBusy}
                          >
                            {'Restore'}
                          </Button>
                        )}
                        {/* Version history, Details and Archive are for the whole assessment,
                            so they sit here on every tab and on New Observation (CP-22
                            round 1). Leaving the document editor or a capture asks first (RV-08). */}
                        <AssessmentActions
                          onHistory={() => guardLeave(v.showVersionHistory)}
                          onDetails={openDetails}
                          onArchive={v.canArchive ? v.openArchive : undefined}
                          archiveBlocked={v.archiveBlocked}
                        />
                      </span>
                    ) : undefined
                  }
                  bell={!v.routeBlocked && desktopBell}
                  tabs={
                    inWorkspace ? (
                      <div className="om-hidebar ws-tabs">
                        {/* From capture, a tab leaves it for that tab. */}
                        <Tabs
                          items={v.tabItems}
                          value={v.tabValue}
                          onChange={
                            v.isField
                              ? v.leaveCaptureTo
                              : (tab: string) => leave(tab === v.tabValue, () => v.setTab(tab))
                          }
                          compact
                        ></Tabs>
                      </div>
                    ) : undefined
                  }
                />
              )}

              <main
                ref={scroller}
                className="om-scroll"
                style={{
                  flex: '1',
                  minHeight: '0',
                  overflow: 'auto',
                  background: 'var(--surface-page)',
                }}
              >
                {v.routeBlocked ? (
                  <AccessDenied roleLabel={v.roleName} onLeave={v.leaveBlocked} />
                ) : (
                  <>
                    {v.isInbox && (
                      <Inbox
                        meId={session.user.id}
                        eyebrow={
                          session.user.role === 'risk_engineer'
                            ? 'Risk engineering'
                            : 'Administration'
                        }
                        bell={desktopBell}
                      />
                    )}

                    {v.isDashboard && <Dashboard v={v} bell={desktopBell} />}

                    {v.isCreate && (
                      <NewAssessment
                        mode={v.newAssessment.start.mode}
                        start={v.newAssessment.start}
                        assign={v.newAssessment.assign}
                        onCreated={v.newAssessment.onCreated}
                        onView={v.newAssessment.onView}
                        onLeave={v.cancelForm}
                        bell={desktopBell}
                      />
                    )}

                    {v.isField && !!reference && <SiteObservation v={v} />}

                    {(v.isAssessment || v.isField) && !!v.workspaceGate && <WorkspaceState v={v} />}

                    {v.isUsers && (
                      <UserAccounts
                        narrow={v.stackTable}
                        currentUserId={v.userId}
                        bell={desktopBell}
                      />
                    )}

                    {v.isClients && (
                      <ClientList
                        {...v.clientList}
                        onStart={v.canEdit ? v.goCreate : undefined}
                        bell={desktopBell}
                      />
                    )}

                    {v.isCalendar && (
                      <Calendar
                        {...v.calendar}
                        onStart={v.canEdit ? v.calendar.onStart : undefined}
                        bell={desktopBell}
                      />
                    )}

                    {v.isClient && <ClientPage {...v.clientPage} bell={desktopBell} />}

                    {v.isKnowledge && (
                      <KnowledgeBase
                        bell={desktopBell}
                        notify={v.notify}
                        canManage={can('knowledge:manage', session)}
                      />
                    )}

                    {v.isUsage && (
                      <Suspense fallback={null}>
                        <UsageCosts isAdmin={v.isAdmin} bell={desktopBell} />
                      </Suspense>
                    )}

                    {v.isSettings && <Settings bell={desktopBell} />}

                    {v.isChat && (
                      <Suspense fallback={null}>
                        <KnowledgeAssistant isAdmin={v.isAdmin} notify={v.notify} />
                      </Suspense>
                    )}

                    {v.isOverview && reference && (
                      <Overview
                        v={v}
                        reference={reference}
                        openDetails={() => setDetailsOpen(true)}
                        goTo={setGoTo}
                      />
                    )}

                    {v.isChecklist && reference && (
                      <Checklist
                        reference={reference}
                        canGenerate={v.canDraftSections}
                        answering={v.checklistTabAnswering}
                        onViewObservation={v.showObservation}
                        area={goTo?.params?.area}
                        item={goTo?.params?.item}
                        archived={v.archivedOpen}
                      />
                    )}

                    {v.isObservations && reference && (
                      <Observations v={v} media={goTo?.params?.media} />
                    )}

                    {v.isPhotos && reference && <Photos v={v} />}

                    {v.isScans && reference && <Scans v={v} />}

                    {v.isRecordings && reference && <Recordings v={v} />}

                    {v.isGenerate && reference && (
                      <DraftingSteps
                        reference={reference}
                        onReview={v.goReview}
                        // A step 2 task opens its section in Review, as a MarshBot link does.
                        onOpenSection={(section) => {
                          v.setTab('review')
                          setGoTo({ tab: 'review', params: { section } })
                        }}
                        onObservations={v.goObservations}
                        archived={v.archivedOpen}
                      />
                    )}

                    {v.isReview && reference && (
                      <ReviewWorkspace
                        reference={reference}
                        assessment={v.liveRecord}
                        canReview={v.canDraftSections}
                        canComment={v.canComment}
                        me={{ id: session.user.id, name: session.user.name }}
                        wrapStyle={v.reviewWrapStyle}
                        railStyle={v.reviewRailStyle}
                        panelStyle={v.reviewEvidenceStyle}
                        onGenerate={() => v.setTab('generate')}
                        historyRequest={v.reviewHistory}
                        openSection={goTo?.params?.section}
                        canAsk={v.canAsk}
                        archived={v.archivedOpen}
                        // Writing guidance's Go to observation (AS-08), past an
                        // unsaved document's leave guard as the tabs are.
                        onViewObservation={(id) =>
                          guardLeave(() => (id ? v.showObservation(id) : v.setTab('observations')))
                        }
                      />
                    )}

                    {v.isComparison && reference && (
                      <ComparisonTab
                        reference={reference}
                        // An observation or a section opens past an unsaved document's leave
                        // guard, as the tabs do.
                        onViewObservation={(id) => guardLeave(() => v.showObservation(id))}
                        onOpenSection={(section) =>
                          guardLeave(() => {
                            v.setTab('review')
                            setGoTo({ tab: 'review', params: { section } })
                          })
                        }
                      />
                    )}

                    {v.isExport && reference && (
                      <ReportExport
                        reference={reference}
                        assessment={v.liveRecord}
                        canExport={v.canExportReport}
                        // A blocker opens its own section in Review, as Generation's tasks do.
                        onReview={(section) => {
                          v.setTab('review')
                          if (section) setGoTo({ tab: 'review', params: { section } })
                        }}
                        onGenerate={() => v.setTab('generate')}
                      />
                    )}
                  </>
                )}
              </main>
            </div>
          </div>

          <Dialog
            open={v.archiveOpen}
            title="Archive this assessment?"
            description="It moves off your work list and stops taking new observations. Everything is kept, and you can find it by filtering Stage to Archived."
            footer={
              <>
                <Button pill variant="secondary" onClick={v.closeArchive} disabled={v.archiveBusy}>
                  {'Cancel'}
                </Button>
                <Button
                  pill
                  variant="primary"
                  iconLeft="archive"
                  onClick={v.confirmArchive}
                  disabled={v.archiveBusy}
                >
                  {'Archive'}
                </Button>
              </>
            }
            onClose={v.closeArchive}
            width={440}
          ></Dialog>
          {v.isAssessment && !!reference && (
            <DetailsPanel v={v} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
          )}
          {/* Sonner's toaster (CP-23); callers use `toast` from the design system. */}
          <Toaster />
        </div>
      </div>
    </>
  )
}
