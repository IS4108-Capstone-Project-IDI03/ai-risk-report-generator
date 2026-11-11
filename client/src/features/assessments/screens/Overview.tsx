import { useState } from 'react'
import type * as React from 'react'
import { Button, Icon } from '../../../design-system'
import { EditSiteDialog } from '../../clients/ClientDialogs'
import { EditDetailsDialog } from '../components/EditDetailsDialog'
import { SiteMapCard } from '../components/SiteMapCard'
import { StatBox, type BoxContent } from '../components/StatBox'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { MarshBotOverview } from '../../marshbot/screens/MarshBotOverview'
import type { ItemLink } from '../../marshbot/types'
import { openSiteWalkReview } from '../../site-walk/openReview'

// The assessment's Overview. A saved assessment is a conversation with MarshBot (AS-06): its
// stage, next step and gaps. A sample (offline) one keeps the at-a-glance boxes below, with no
// report data, since MarshBot reads everything from the gateway.
export function Overview({
  v,
  openDetails,
  goTo,
}: {
  v: AssessmentWorkflow
  openDetails: () => void
  // Hands a link's checklist area or report section to the tab it opens (AssessmentApp).
  goTo: (link: ItemLink) => void
}) {
  return v.liveReference ? (
    <MarshBotOverview
      reference={v.liveReference}
      openLink={(link) => {
        const { walk, obs, details } = link.params ?? {}
        if (details) return openDetails()
        if (walk) return openSiteWalkReview(v.liveReference!, walk)
        if (obs) return v.showObservation(obs)
        v.setTab(link.tab)
        goTo(link)
      }}
      openDetails={openDetails}
    />
  ) : (
    <OverviewLayout v={v} />
  )
}

const card: React.CSSProperties = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  boxShadow: 'var(--shadow-sm)',
}
const cardHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '14px 20px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--surface-sunken)',
  fontSize: '19px',
  lineHeight: '28px',
  fontWeight: '600',
  color: 'var(--text-primary)',
}
// A sample assessment has no report on the server to count from.
const NOT_AVAILABLE: BoxContent = {
  value: '—',
  unit: 'not available',
  note: 'Needs the assessment on the server',
}

const unit = (n: number, word: string) => word + (n === 1 ? '' : 's')

type Fact = AssessmentWorkflow['ovSiteFacts'][number]

// A card's label and value rows. A value that opens something, the client's
// page (CP-18), reads as a link.
function Facts({ facts }: { facts: Fact[] }) {
  return (
    <div style={{ padding: '6px 20px 14px' }}>
      {facts.map((ff) => (
        <div
          key={ff.label}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '16px',
            padding: '10px 0',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <span
            style={{
              flex: '0 0 auto',
              width: '150px',
              fontSize: '14px',
              color: 'var(--text-muted)',
            }}
          >
            {ff.label}
          </span>
          <span
            style={{
              flex: '1',
              minWidth: '0',
              fontSize: '15px',
              lineHeight: '22px',
              color: 'var(--text-body)',
              textWrap: 'pretty',
            }}
          >
            {ff.open ? (
              <button type="button" className="text-link" onClick={ff.open}>
                {ff.value}
              </button>
            ) : (
              ff.value
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function OverviewLayout({ v }: { v: AssessmentWorkflow }) {
  const capture = v.ovCapture
  // Edit site and Edit details open over the Overview (CP-18).
  const [dialog, setDialog] = useState<'site' | 'details' | null>(null)
  const edit = v.ovEdit
  return (
    <>
      <div
        style={{
          padding: '24px clamp(16px,2vw,28px) 40px',
          animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
        }}
      >
        <div
          className="om-overview-wrap"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          {/* Two to a row, or four where there is room, never three and one
              (workflow.css). */}
          <div className="om-overview-boxes">
            {/* Capturing is the header's Add observation; this box
                opens the observations it counts. */}
            <StatBox
              icon="camera"
              label="Capture"
              content={{
                value: String(capture.count),
                unit: unit(capture.count, 'observation'),
                note: capture.note,
              }}
              onOpen={() => v.setTab('observations')}
              opens="Observations"
            />
            <StatBox icon="sparkles" label="Drafting" content={NOT_AVAILABLE} />
            <StatBox icon="user-round-search" label="Review" content={NOT_AVAILABLE} />
            <StatBox icon="calendar-clock" label="Report due" content={v.ovDue} />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px),1fr))',
              gap: '16px',
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
              {/* The site, and Edit site, which changes it for every
                  assessment at it (CP-18); or why it can't be changed. */}
              <section aria-label="Site" style={{ ...card, overflow: 'hidden' }}>
                <div style={cardHead}>
                  {'Site'}
                  {edit?.site.allowed && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft="pencil"
                      onClick={() => setDialog('site')}
                    >
                      {'Edit site'}
                    </Button>
                  )}
                </div>
                <Facts facts={v.ovSiteFacts} />
                {edit && !edit.site.allowed && !!edit.site.reason && (
                  <p
                    style={{
                      margin: 0,
                      padding: '0 20px 16px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '6px',
                      fontSize: '14px',
                      lineHeight: '20px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <Icon name="info" size={16} color="var(--text-muted)" />
                    <span>{edit.site.reason}</span>
                  </p>
                )}
              </section>
              {/* This assessment's own details, and Edit details (RV-10 AC10). */}
              <section aria-label="Assessment record" style={{ ...card, overflow: 'hidden' }}>
                <div style={cardHead}>
                  {'Assessment record'}
                  {edit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft="pencil"
                      onClick={() => setDialog('details')}
                    >
                      {'Edit details'}
                    </Button>
                  )}
                </div>
                <Facts facts={v.ovRecordFacts} />
              </section>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
              {v.ovMap && <SiteMapCard {...v.ovMap} onSaved={v.siteSaved} />}
              <ReportSections />
            </div>
          </div>
        </div>
      </div>
      {dialog === 'site' && edit && (
        <EditSiteDialog
          site={edit.record.site}
          assessments={edit.site.assessments}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null)
            void v.siteSaved(message)
          }}
        />
      )}
      {dialog === 'details' && edit && (
        <EditDetailsDialog
          record={edit.record}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null)
            void v.detailsSaved(message)
          }}
        />
      )}
    </>
  )
}

// Where the report sections stand needs the assessment on the server.
function ReportSections() {
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={cardHead}>{'Report sections'}</div>
      <p style={{ margin: 0, padding: '14px 20px', fontSize: '15px', color: 'var(--text-muted)' }}>
        {'The report sections show here once this assessment is saved on the server.'}
      </p>
    </div>
  )
}
