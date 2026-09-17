import { Button, Dialog, Icon, SideNav, Tabs, Toast } from '../../design-system'
import type { AssessmentWorkflow } from './useAssessmentWorkflow'
import './workflow.css'
import { Dashboard } from './screens/Dashboard'
import { CreateAssessment } from './screens/CreateAssessment'
import { SiteObservation } from './screens/SiteObservation'
import { Overview } from './screens/Overview'
import { Observations } from './screens/Observations'
import { Generation } from './screens/Generation'
import { Review } from './screens/Review'
import { ValidationExport } from './screens/ValidationExport'

export function AssessmentApp({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div className="workflow">
        <div className="workflow-frame">
          <div style={{ display: 'flex', height: '100%' }}>
            {!!v.showSideNav && (
              <>
                <SideNav
                  product="Risk Report Generator"
                  sections={v.navSections}
                  value={v.navValue}
                  onChange={v.go}
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
                onChange={v.goFromDrawer}
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
                    <button
                      type="button"
                      onClick={v.toggleNav}
                      aria-label="Open navigation"
                      style={{
                        flex: '0 0 auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                        border: 'none',
                        borderRadius: '99px',
                        background: 'transparent',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon name="menu" size={18}></Icon>
                    </button>
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
                    <span style={{ flex: '0 0 auto', width: '36px' }}></span>
                  </div>
                </>
              )}

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
                  <div style={{ minWidth: '0', flex: '1' }}>
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
                      {v.title}
                    </h1>
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
                    {v.isDashboard && (
                      <>
                        <Button variant="secondary" iconLeft="camera" onClick={v.goField}>
                          Site observation
                        </Button>
                        <Button variant="primary" iconLeft="plus" onClick={v.goCreate}>
                          New assessment
                        </Button>
                      </>
                    )}
                    {!!v.isAssessment && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Button variant="ghost" iconLeft="history" onClick={v.showVersionHistory}>
                            {'Version history'}
                          </Button>
                          <Button variant="secondary" iconLeft="camera" onClick={v.goField}>
                            {'Site observation'}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {!!v.isAssessment && (
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
                      <Tabs items={v.tabItems} value={v.tab} onChange={v.setTab}></Tabs>
                    </div>
                  </>
                )}
              </div>

              <main
                className="om-scroll"
                style={{
                  flex: '1',
                  minHeight: '0',
                  overflow: 'auto',
                  background: 'var(--surface-page)',
                }}
              >
                {v.isDashboard && <Dashboard v={v} />}

                {v.isCreate && <CreateAssessment v={v} />}

                {v.isField && <SiteObservation v={v} />}

                {v.isOverview && <Overview v={v} />}

                {v.isObservations && <Observations v={v} />}

                {v.isGenerate && <Generation v={v} />}

                {v.isReview && <Review v={v} />}

                {v.isExport && <ValidationExport v={v} />}
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
          {!!v.toast && (
            <>
              <div className="workflow-toast" role="status">
                <Toast tone={v.toastTone} message={v.toast} onDismiss={v.clearToast}></Toast>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
