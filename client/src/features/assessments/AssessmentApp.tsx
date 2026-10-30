import { lazy, Suspense } from 'react'
import { Button, Dialog, EmptyState, Icon, SideNav, Tabs, Toast } from '../../design-system'
import type { Session } from '../auth/api'
import { NotificationBell } from '../notifications/NotificationBell'
import type { AssessmentWorkflow } from './useAssessmentWorkflow'
import { guardLeave } from './leaveGuard'
import './workflow.css'
import { Dashboard } from './screens/Dashboard'
import { CreateAssessment } from './screens/CreateAssessment'
import { SiteObservation } from './screens/SiteObservation'
import { MoreMenu } from './components/MoreMenu'
import { Overview } from './screens/Overview'
import { Checklist } from './screens/Checklist'
import { Observations } from './screens/Observations'
import { Generation } from './screens/Generation'
import { SectionDrafts } from './screens/SectionDrafts'
import { ReviewWorkspace } from './screens/ReviewWorkspace'
import { Review } from './screens/Review'
import { ValidationExport } from './screens/ValidationExport'
import { Photos } from './screens/Photos'
import { Scans } from './screens/Scans'
import { UserAccounts } from '../accounts/UserAccounts'
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

export function AssessmentApp({ v, session }: { v: AssessmentWorkflow; session: Session }) {
  const captureOnPhone = v.isField && v.phone && !v.routeBlocked
  // Going somewhere else asks first while the document editor has unsaved
  // changes (RV-08 AC14); choosing where you already are does not.
  const leave = (staying: boolean, go: () => void) => (staying ? go() : guardLeave(go))
  return (
    <>
      {/* data-sidenav lets fixed overlays centre on the content, not the window. */}
      <div className="workflow" data-sidenav={v.showSideNav || undefined}>
        <div className="workflow-frame">
          <div style={{ display: 'flex', height: '100%' }}>
            {!!v.showSideNav && (
              <>
                <SideNav
                  product="Risk Report Generator"
                  sections={v.navSections}
                  value={v.navValue}
                  onChange={(to: string) => leave(to === v.navValue, () => v.go(to))}
                  footer={v.navFooter}
                ></SideNav>
              </>
            )}
            <Dialog
              className="navigation-drawer"
              open={v.navOpen}
              ariaLabel="Navigation"
              onClose={v.closeNav}
              width={264}
            >
              <SideNav
                product="Risk Report Generator"
                sections={v.navSections}
                value={v.navValue}
                onChange={(to: string) => leave(to === v.navValue, () => v.goFromDrawer(to))}
                footer={v.navFooter}
              />
            </Dialog>
            <div style={{ flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column' }}>
              {!!v.showTopBar && (
                <>
                  <div
                    style={{
                      flex: '0 0 auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 16px',
                      background: 'var(--marsh-navy)',
                      color: '#fff',
                    }}
                  >
                    {/* Capture on a phone is a screen drilled into: the bar
                        says what it is, with ← back to the Observations tab
                        in place of the menu. */}
                    <button
                      type="button"
                      onClick={captureOnPhone ? v.leaveCapture : v.toggleNav}
                      aria-label={captureOnPhone ? 'Back to observations' : 'Open navigation'}
                      style={{
                        flex: '0 0 auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: captureOnPhone ? '44px' : '36px',
                        height: captureOnPhone ? '44px' : '36px',
                        border: 'none',
                        borderRadius: '99px',
                        background: 'transparent',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon name={captureOnPhone ? 'arrow-left' : 'menu'} size={18}></Icon>
                    </button>
                    {captureOnPhone ? (
                      <h1
                        style={{
                          flex: '1',
                          minWidth: '0',
                          margin: '0',
                          fontSize: '17px',
                          fontWeight: '600',
                          letterSpacing: '-0.01em',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {'New observation'}
                      </h1>
                    ) : (
                      <span
                        style={{
                          flex: '1',
                          minWidth: '0',
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'center',
                          gap: '8px',
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          style={{ fontSize: '16px', fontWeight: '600', letterSpacing: '-0.01em' }}
                        >
                          {'Marsh'}
                        </span>
                        <span
                          style={{
                            fontSize: '14px',
                            color: 'rgba(255,255,255,0.62)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {'Risk Report Generator'}
                        </span>
                      </span>
                    )}
                    <span style={{ flex: '0 0 auto' }}>
                      <NotificationBell counts={session.notifications} tone="dark" />
                    </span>
                  </div>
                </>
              )}

              {/* Capture keeps the workspace's header and tabs. On a phone the
                  top bar stands in for them, leaving the screen to the form. */}
              {!captureOnPhone && (
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
                    {!!v.showHeaderMenu && (
                      <>
                        <button
                          type="button"
                          onClick={v.toggleNav}
                          aria-label="Toggle navigation"
                          style={{
                            flex: '0 0 auto',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '36px',
                            height: '36px',
                            marginTop: '2px',
                            border: 'none',
                            borderRadius: '99px',
                            background: 'transparent',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'var(--transition-control)',
                          }}
                          data-hoverable="true"
                        >
                          <Icon name="menu" size={18}></Icon>
                        </button>
                      </>
                    )}
                    <div style={{ minWidth: '0', flex: v.showTopBar ? '1 0 100%' : '1' }}>
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
                      {v.isDashboard && !v.routeBlocked && v.canEdit && (
                        <Button variant="primary" iconLeft="plus" onClick={v.goCreate}>
                          New assessment
                        </Button>
                      )}
                      {/* The main action, then the occasional ones behind ⋯.
                        Restore stays visible: it is the one thing to do with
                        an archived assessment. */}
                      {!!v.isAssessment && !v.routeBlocked && (
                        <>
                          {v.canEdit && v.canCapture && (
                            <Button
                              variant="primary"
                              iconLeft="plus"
                              onClick={() => guardLeave(v.goField)}
                            >
                              {'Add observation'}
                            </Button>
                          )}
                          {v.canRestore && (
                            <Button
                              variant="secondary"
                              iconLeft="refresh-cw"
                              onClick={v.restoreAssessment}
                              disabled={v.archiveBusy}
                            >
                              {'Restore'}
                            </Button>
                          )}
                          <MoreMenu
                            items={[
                              {
                                label: 'Version history',
                                icon: 'history',
                                // Leaving the document editor for it asks
                                // first, as leaving it for a tab does (RV-08).
                                onSelect: () => guardLeave(v.showVersionHistory),
                              },
                              ...(v.canArchive
                                ? [{ label: 'Archive', icon: 'archive', onSelect: v.openArchive }]
                                : []),
                            ]}
                          />
                        </>
                      )}
                      {/* Desktop has no top bar, so the bell lives in the page
                        header. On phones the navy bar carries it instead, so
                        this copy is suppressed to avoid a second one. */}
                      {!v.showTopBar && !v.routeBlocked && (
                        <NotificationBell counts={session.notifications} />
                      )}
                    </div>
                  </div>
                  {(!!v.isAssessment || v.isField) && !v.routeBlocked && (
                    <>
                      <div
                        className="om-hidebar"
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
                    {v.isDashboard && <Dashboard v={v} />}

                    {v.isCreate && <CreateAssessment v={v} />}

                    {v.isField && <SiteObservation v={v} />}

                    {v.isUsers && <UserAccounts narrow={v.stackTable} currentUserId={v.userId} />}

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

                    {v.isOverview && <Overview v={v} />}

                    {v.isChecklist &&
                      (v.liveReference ? (
                        <Checklist reference={v.liveReference} canGenerate={v.canDraftSections} />
                      ) : (
                        <div style={{ padding: '24px' }}>
                          <EmptyState
                            icon="list-checks"
                            title="No checklist for the sample assessment"
                            description="Checklists are generated for saved assessments. Open one from the dashboard to generate its checklist."
                          />
                        </div>
                      ))}

                    {v.isObservations && <Observations v={v} />}

                    {v.isPhotos && <Photos v={v} />}

                    {v.isScans && <Scans v={v} />}

                    {v.isGenerate &&
                      (v.liveReference ? (
                        <SectionDrafts
                          reference={v.liveReference}
                          canDraft={v.canDraftSections}
                          onCapture={v.canCapture ? v.goField : undefined}
                          onReview={v.goReview}
                        />
                      ) : (
                        <Generation v={v} />
                      ))}

                    {v.isReview &&
                      (v.liveReference ? (
                        <ReviewWorkspace
                          reference={v.liveReference}
                          canReview={v.canDraftSections}
                          wrapStyle={v.reviewWrapStyle}
                          railStyle={v.reviewRailStyle}
                          panelStyle={v.reviewEvidenceStyle}
                          onGenerate={() => v.setTab('generate')}
                          historyRequest={v.reviewHistory}
                        />
                      ) : (
                        <Review v={v} />
                      ))}

                    {v.isExport && <ValidationExport v={v} />}
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
            title="Archive this assessment?"
            description="It leaves your work list and takes no new observations. Everything it holds is kept, and you can still find it by filtering by Archived."
            footer={
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <Button variant="secondary" onClick={v.closeArchive} disabled={v.archiveBusy}>
                  {'Cancel'}
                </Button>
                <Button
                  variant="primary"
                  iconLeft="archive"
                  onClick={v.confirmArchive}
                  disabled={v.archiveBusy}
                >
                  {'Archive'}
                </Button>
              </div>
            }
            onClose={v.closeArchive}
            width={480}
          ></Dialog>
          {!!v.toast && (
            <>
              {/* Keyed by message: a new toast starts fresh, even if the last one was fading out. */}
              <div
                key={v.toast}
                className={v.isChat ? 'workflow-toast chat-toast' : 'workflow-toast'}
              >
                <Toast tone={v.toastTone} message={v.toast} onDismiss={v.clearToast}></Toast>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
