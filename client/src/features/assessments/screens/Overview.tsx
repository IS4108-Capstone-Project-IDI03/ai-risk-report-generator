import { useState } from 'react'
import type * as React from 'react'
import { Icon, IconAction } from '../../../design-system'
import { EditSiteDialog } from '../../clients/ClientDialogs'
import { EditDetailsDialog } from '../components/EditDetailsDialog'
import { SiteMapCard } from '../components/SiteMapCard'
import { StatBox, type BoxContent } from '../components/StatBox'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { MarshBotOverview } from '../../marshbot/screens/MarshBotOverview'
import type { ItemLink } from '../../marshbot/types'
import { openOverviewLink } from '../openOverviewLink'

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
      openLink={(link) =>
        openOverviewLink(link, {
          reference: v.liveReference!,
          setTab: v.setTab,
          showObservation: v.showObservation,
          openDetails,
          goTo,
        })
      }
      openDetails={openDetails}
      archived={v.archivedOpen}
    />
  ) : (
    <OverviewLayout v={v} />
  )
}

// v2 cards: white, 1 px border, radius 16, no shadow (only floating things have one).
const card: React.CSSProperties = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-card)',
}
// A card's title line: 16 / 700 navy, its one action an icon at the right.
const cardHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  minHeight: '52px',
  padding: '10px 12px 10px 20px',
  boxSizing: 'border-box',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: '16px',
  lineHeight: '22px',
  fontWeight: '700',
  color: 'var(--marsh-navy)',
}
// A sample assessment has no report on the server to count from.
const NOT_AVAILABLE: BoxContent = {
  value: '—',
  note: 'Shows once the assessment is saved',
}

const unit = (n: number, word: string) => word + (n === 1 ? '' : 's')

type Fact = AssessmentWorkflow['ovSiteFacts'][number]

// A card's label and value rows. A value that opens something, the client's
// page (CP-18), reads as a link.
function Facts({ facts }: { facts: Fact[] }) {
  return (
    <div style={{ padding: '4px 20px 12px' }}>
      {facts.map((ff, i) => (
        <div
          key={ff.label}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '16px',
            padding: '10px 0',
            // Hairlines between rows only: the card's title line already has one above.
            borderTop: i ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          <span
            style={{
              flex: '0 0 auto',
              width: 'min(140px, 38%)',
              fontSize: '13px',
              color: 'var(--text-muted)',
            }}
          >
            {ff.label}
          </span>
          <span
            style={{
              flex: '1',
              minWidth: '0',
              fontSize: '14px',
              lineHeight: '20px',
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
          // The page gutter, down to 16 px on a phone.
          padding: '24px clamp(16px, 4vw, var(--page-gutter)) 40px',
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
                    <IconAction icon="pencil" label="Edit site" onClick={() => setDialog('site')} />
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
                    <IconAction
                      icon="pencil"
                      label="Edit details"
                      onClick={() => setDialog('details')}
                    />
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
      <p
        style={{
          margin: 0,
          padding: '14px 20px 16px',
          fontSize: '14px',
          color: 'var(--text-muted)',
        }}
      >
        {'Report sections show here once the assessment is saved.'}
      </p>
    </div>
  )
}
