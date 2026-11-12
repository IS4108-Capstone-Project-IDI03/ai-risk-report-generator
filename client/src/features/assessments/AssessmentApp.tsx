import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  EmptyState,
  IconRegistry,
  NavDrawer,
  PhoneBar,
  SideNav,
  Tabs,
  Toast,
  Toaster,
} from '../../design-system'
import type { Session } from '../auth/api'
import { NotificationBell } from '../notifications/NotificationBell'
import { useNotificationCounts } from '../notifications/useNotificationCounts'
import { Inbox } from '../inbox/screens/Inbox'
import { assessmentOpen, assessmentsStale } from './openAssessment'
import type { AssessmentWorkflow } from './useAssessmentWorkflow'
import { guardLeave } from './leaveGuard'
import { ScreenMotion } from './ScreenMotion'
import { AssessmentActions } from './components/AssessmentActions'
import { siteWalkReview } from '../site-walk/openReview'
import { DetailsPanel } from '../marshbot/components/DetailsPanel'
import './workflow.css'
import { Dashboard } from './screens/Dashboard'
import { NewAssessment } from '../new-assessment/screens/NewAssessment'
import { NewAssessmentButton } from '../new-assessment/components/NewAssessmentButton'
import { SiteObservation } from './screens/SiteObservation'
import { Overview } from './screens/Overview'
import { Checklist } from './screens/Checklist'
import { Observations } from './screens/Observations'
import { Generation } from './screens/Generation'
import { SectionDrafts } from './screens/SectionDrafts'
import { ReviewWorkspace } from './screens/ReviewWorkspace'
import { Review } from './screens/Review'
import { ReportExport } from './screens/ReportExport'
import { ValidationExport } from './screens/ValidationExport'
import { Photos } from './screens/Photos'
import { Scans } from './screens/Scans'
import { UserAccounts } from '../accounts/UserAccounts'
import { ClientList } from '../clients/ClientList'
import { ClientPage } from '../clients/ClientPage'
import type { ItemLink } from '../marshbot/types'
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
  const captureOnPhone = v.isField && v.phone && !v.routeBlocked
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
    window.addEventListener(assessmentsStale.event, v.refreshList)
    return () => {
      window.removeEventListener(assessmentsStale.event, v.refreshList)
      window.removeEventListener(siteWalkReview.event, open)
      window.removeEventListener(assessmentOpen.event, openOverview)
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
                  bell={<NotificationBell tone="dark" />}
                  back={
                    captureOnPhone
                      ? {
                          label: v.proposalCapture ? 'Back to site walk' : 'Back to observations',
                          title: 'New Observation',
                          onClick: v.leaveCapture,
                        }
                      : undefined
                  }
                />
              )}

              {/* Capture keeps the workspace's header and tabs. On a phone the
                  top bar stands in for them, leaving the screen to the form. A
                  client's page heads itself with the client's name (CP-23). */}
              {!captureOnPhone &&
                !(v.isClient && !v.routeBlocked) &&
                !(v.isClients && !v.routeBlocked) &&
                !(v.isDashboard && !v.routeBlocked) &&
                // The Inbox heads itself with the kit TopBar (F-10).
                !(v.isInbox && !v.routeBlocked) &&
                // New Assessment heads itself with the kit TopBar and its Create (CP-23).
                !(v.isCreate && !v.routeBlocked) && (
                  <div
                    style={{
                      flex: '0 0 auto',
                      background: 'var(--surface-card)',
                      borderBottom: '1px solid var(--border-default)',
                      padding: '20px clamp(16px,2vw,28px) 0',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '12px 20px',
                        paddingBottom: '16px',
                      }}
                    >
                      <div style={{ minWidth: '0', flex: v.showTopBar ? '1 0 100%' : '1' }}>
                        {!!v.eyebrow && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              marginBottom: '6px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '13px',
                                fontWeight: '600',
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {v.eyebrow}
                            </span>
                          </div>
                        )}
                        <h1
                          style={{
                            margin: '0',
                            fontSize: 'clamp(23px,2.4vw,32px)',
                            lineHeight: '1.2',
                            fontWeight: '700',
                            letterSpacing: '-0.02em',
                            color: 'var(--text-primary)',
                            overflowWrap: 'anywhere',
                            textWrap: 'pretty',
                          }}
                        >
                          {v.routeBlocked ? 'Access restricted' : v.title}
                        </h1>
                        {!v.routeBlocked && !!v.meta && (
                          <div
                            style={{
                              marginTop: '6px',
                              fontSize: '15px',
                              lineHeight: '22px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {v.meta}
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          flex: '0 1 auto',
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '8px',
                          paddingTop: '6px',
                        }}
                      >
                        {v.isClients && !v.routeBlocked && v.canEdit && (
                          <NewAssessmentButton onStart={v.goCreate} />
                        )}
                        {/* Restore stays visible: it is the one thing to do with an
                        archived assessment. Capturing starts from the
                        Observations tab's own buttons (CP-22). */}
                        {(!!v.isAssessment || v.isField) && !v.routeBlocked && (
                          <>
                            {v.canRestore && (
                              <Button
                                variant="secondary"
                                iconLeft={IconRegistry.action.reinstate}
                                onClick={v.restoreAssessment}
                                disabled={v.archiveBusy}
                              >
                                {'Restore'}
                              </Button>
                            )}
                            {/* Version history and Archive are for the whole assessment,
                            so they sit here on every tab and on New Observation
                            (CP-22 round 1). Leaving the document editor or a
                            capture for history asks first (RV-08). */}
                            <AssessmentActions
                              onHistory={() => guardLeave(v.showVersionHistory)}
                              onDetails={openDetails}
                              onArchive={v.canArchive ? v.openArchive : undefined}
                            />
                          </>
                        )}
                        {/* Desktop has no top bar, so the bell lives in the page
                        header. On phones the navy bar carries it instead, so
                        this copy is suppressed to avoid a second one. */}
                        {!v.showTopBar && !v.routeBlocked && <NotificationBell />}
                      </div>
                    </div>
                    {(!!v.isAssessment || v.isField) && !v.routeBlocked && (
                      <>
                        <div
                          className="om-hidebar ws-tabs"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            overflowX: 'auto',
                            scrollbarWidth: 'none',
                          }}
                        >
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
                      </>
                    )}
                  </div>
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
                        // Desktop has no top bar, so the bell sits in the page's own header.
                        bell={!v.showTopBar && <NotificationBell />}
                      />
                    )}

                    {v.isDashboard && (
                      <Dashboard
                        v={v}
                        // Desktop has no top bar, so the bell sits in the page's own header.
                        bell={!v.showTopBar && <NotificationBell />}
                      />
                    )}

                    {v.isCreate && (
                      <NewAssessment
                        mode={v.newAssessment.start.mode}
                        start={v.newAssessment.start}
                        assign={v.newAssessment.assign}
                        onCreated={v.newAssessment.onCreated}
                        onView={v.newAssessment.onView}
                        onLeave={v.cancelForm}
                        bell={!v.showTopBar && <NotificationBell />}
                      />
                    )}

                    {v.isField && <SiteObservation v={v} />}

                    {v.isUsers && <UserAccounts narrow={v.stackTable} currentUserId={v.userId} />}

                    {v.isClients && (
                      <ClientList
                        {...v.clientList}
                        onStart={v.canEdit ? v.goCreate : undefined}
                        // Desktop has no top bar, so the bell sits in the page's own header.
                        bell={!v.showTopBar && <NotificationBell />}
                      />
                    )}

                    {v.isClient && (
                      <ClientPage
                        {...v.clientPage}
                        // Desktop has no top bar, so the bell sits in the page's own header.
                        bell={!v.showTopBar && <NotificationBell />}
                      />
                    )}

                    {v.isKnowledge && <KnowledgeBase narrow={v.stackTable} notify={v.notify} />}

                    {v.isUsage && (
                      <Suspense fallback={null}>
                        <UsageCosts isAdmin={v.isAdmin} />
                      </Suspense>
                    )}

                    {v.isChat && (
                      <Suspense fallback={null}>
                        <KnowledgeAssistant isAdmin={v.isAdmin} notify={v.notify} />
                      </Suspense>
                    )}

                    {v.isOverview && (
                      <Overview v={v} openDetails={() => setDetailsOpen(true)} goTo={setGoTo} />
                    )}

                    {v.isChecklist &&
                      (v.liveReference ? (
                        <Checklist
                          reference={v.liveReference}
                          canGenerate={v.canDraftSections}
                          answering={v.checklistTabAnswering}
                          onViewObservation={v.showObservation}
                          area={goTo?.params?.area}
                          item={goTo?.params?.item}
                        />
                      ) : (
                        <div style={{ padding: '24px' }}>
                          <EmptyState
                            icon="list-checks"
                            title="No checklist for the sample assessment"
                            description="Checklists are generated for saved assessments. Open one from the dashboard to generate its checklist."
                          />
                        </div>
                      ))}

                    {v.isObservations && <Observations v={v} media={goTo?.params?.media} />}

                    {v.isPhotos && <Photos v={v} />}

                    {v.isScans && <Scans v={v} />}

                    {v.isGenerate &&
                      (v.liveReference ? (
                        <SectionDrafts
                          reference={v.liveReference}
                          canDraft={v.canDraftSections}
                          onCapture={v.canCapture ? v.goField : undefined}
                          onReview={v.goReview}
                          openSection={goTo?.params?.section}
                        />
                      ) : (
                        <Generation v={v} />
                      ))}

                    {v.isReview &&
                      (v.liveReference ? (
                        <ReviewWorkspace
                          reference={v.liveReference}
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
                        />
                      ) : (
                        <Review v={v} />
                      ))}

                    {v.isExport &&
                      (v.liveReference ? (
                        <ReportExport
                          reference={v.liveReference}
                          assessment={v.liveRecord}
                          canExport={v.canExportReport}
                          onReview={() => v.setTab('review')}
                          onGenerate={() => v.setTab('generate')}
                        />
                      ) : (
                        <ValidationExport v={v} />
                      ))}
                  </>
                )}
              </main>
            </div>
          </div>

          <Dialog
            open={v.stopOpen}
            title="Stop generation?"
            description={v.stopDescription}
            footer={v.stopFooter}
            onClose={v.closeStop}
            width={480}
          ></Dialog>
          <Dialog
            open={v.exportOpen}
            title={v.exportDialogTitle}
            description={v.exportDialogBody}
            footer={v.exportFooter}
            onClose={v.closeExport}
            width={520}
          ></Dialog>
          <Dialog
            open={v.archiveOpen}
            className="ds-dialog--v2"
            title="Archive this assessment?"
            description="It moves off your work list and stops taking new observations. Everything is kept, and you can find it by filtering Status to Archived."
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
          {v.isAssessment && (
            <DetailsPanel v={v} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
          )}
          {/* Sonner's toaster (CP-23); callers use `toast` from the design system. */}
          <Toaster />
          {!!v.toast && (
            <>
              {/* Keyed by message: a new toast starts fresh, even if the last one was fading out. */}
              <div
                key={v.toast}
                className={v.isChat ? 'workflow-toast chat-toast' : 'workflow-toast'}
              >
                <Toast
                  tone={v.toastTone}
                  message={v.toast}
                  onDismiss={v.clearToast}
                  action={
                    !!v.toastView && (
                      <Button variant="link" size="sm" onClick={v.openToastView}>
                        {'View'}
                      </Button>
                    )
                  }
                ></Toast>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
