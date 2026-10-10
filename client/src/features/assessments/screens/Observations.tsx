import { Fragment } from 'react'
import type * as React from 'react'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Icon,
  IconRegistry,
  Select,
} from '../../../design-system'
import { AddMediaDialog } from '../components/AddMediaDialog'
import { StatBox } from '../components/StatBox'
import { DeleteDialog, RemoveMediaDialog, TranscriptDialog } from '../components/ObservationDialogs'
import { TagDialog } from '../components/TagDialog'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import type { TranscriptionStatus } from '../api'

const STATUS_BADGE = {
  transcribing: { tone: 'info', label: 'Transcribing' },
  transcribed: { tone: 'low', label: 'Transcribed' },
  failed: { tone: 'high', label: 'Failed' },
} as const satisfies Record<TranscriptionStatus, { tone: string; label: string }>

type Row = AssessmentWorkflow['obsList'][number]

// Where an observation's recordings stand (CP-08 AC2). Only one needing the
// engineer's eyes is badged; Complete is the norm, so it stays quiet.
function ObservationStatus({ o }: { o: Row }) {
  return o.statusTone ? (
    <Badge tone={o.statusTone}>{o.status}</Badge>
  ) : (
    <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{o.status}</span>
  )
}

// Who last changed or deleted it, and when: "Edited by Alex Rowe · 07 Oct 14:02".
const stampStyle = {
  margin: '8px 0 0',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  color: 'var(--text-muted)',
} as const

const proposalSection = {
  marginTop: '14px',
  paddingTop: '12px',
  borderTop: '1px solid var(--border-subtle)',
} as const
const proposalHeading = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexWrap: 'wrap',
  fontSize: '14px',
  fontWeight: '500',
  color: 'var(--text-primary)',
} as const

// What the vision model proposes from the observation's photos (CP-05): a
// machine reading, so it sits in AI violet with the photos it was read from,
// and becomes the engineer's own only through Edit. Nothing reads the photos
// until an engineer asks, so until then it offers Read photos.
// The heading over one column of an open observation.
function ColumnHead({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '11px',
        fontWeight: '600',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </div>
  )
}

function PhotoProposal({ o, proposal }: { o: Row; proposal: NonNullable<Row['proposal']> }) {
  if (proposal.status === 'unread')
    return (
      <section aria-label="Proposal from the photos" style={proposalSection}>
        <div style={proposalHeading}>
          <Icon name="camera" size={14} color="#4f9aee"></Icon>
          <span>{'Proposal from the photos'}</span>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--text-muted)' }}>
          {
            'Not read yet. Reading sends the photos to the photo service, which proposes a description, category and hazard type for you to review.'
          }
        </p>
        {!!proposal.read && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={IconRegistry.action.generate}
            onClick={proposal.read}
            style={{ marginTop: '8px' }}
          >
            {'Read photos'}
          </Button>
        )}
      </section>
    )
  return (
    <section aria-label="Proposal from the photos" style={proposalSection}>
      <div style={proposalHeading}>
        <Icon name="camera" size={14} color="#4f9aee"></Icon>
        <span>{'Proposal from the photos'}</span>
        <Badge tone="ai" icon="sparkles">
          {proposal.sample ? 'Sample proposal' : 'AI proposal'}
        </Badge>
        {proposal.status === 'interpreting' && <Badge tone="info">Interpreting</Badge>}
        {proposal.status === 'failed' && <Badge tone="high">Failed</Badge>}
      </div>
      {proposal.status === 'failed' ? (
        <div role="status" style={{ marginTop: '8px' }}>
          <Callout
            tone="warning"
            title="Interpretation failed"
            actions={
              proposal.retry && (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft="refresh-cw"
                  onClick={proposal.retry}
                >
                  {'Retry interpretation'}
                </Button>
              )
            }
          >
            {proposal.error}
          </Callout>
        </div>
      ) : proposal.status === 'interpreting' ? (
        <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--text-muted)' }}>
          {'Interpreting the photos…'}
        </p>
      ) : (
        <>
          {/* Photos were added or removed since it was read (CP-08). */}
          {!!proposal.outOfDate && (
            <div role="status" style={{ marginTop: '8px' }}>
              <Callout
                tone="warning"
                title="Read from an earlier set of photos"
                actions={
                  proposal.retry && (
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft="refresh-cw"
                      onClick={proposal.retry}
                    >
                      {'Read again'}
                    </Button>
                  )
                }
              >
                {
                  'Photos were added or removed since this was read. Read them again to include the change.'
                }
              </Callout>
            </div>
          )}
          <p
            style={{
              margin: '6px 0 0',
              paddingLeft: '12px',
              borderLeft: '2px solid var(--ai-border)',
              fontSize: '15px',
              lineHeight: '24px',
              color: 'var(--text-body)',
              maxWidth: '68ch',
              textWrap: 'pretty',
            }}
          >
            {proposal.description}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--text-secondary)' }}>
            {proposal.summary}
          </p>
          {/* The photos it was read from, each opening the original (AC6),
              marking any since removed (CP-08). */}
          <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--text-secondary)' }}>
            {'Read from '}
            {(proposal.readFrom ?? o.media.map((m) => ({ ...m, removed: false }))).map(
              (m, index) => (
                <Fragment key={index}>
                  {index > 0 && ', '}
                  {m.url ? (
                    <a href={m.url} target="_blank" rel="noreferrer">
                      {m.name}
                    </a>
                  ) : (
                    m.name
                  )}
                  {m.removed && ' (removed)'}
                </Fragment>
              ),
            )}
          </p>
          <p style={stampStyle}>
            {proposal.sample
              ? 'No capture session, so this is a sample proposal, not a reading of the photos.'
              : 'Proposed by ' + (proposal.model ?? 'the photo service')}
          </p>
          {(!!proposal.useAsNote || !!proposal.addCategory) && (
            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {!!proposal.useAsNote && (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft="sticky-note"
                  onClick={proposal.useAsNote}
                >
                  {'Use as note'}
                </Button>
              )}
              {!!proposal.addCategory && (
                <Button variant="secondary" size="sm" iconLeft="tag" onClick={proposal.addCategory}>
                  {'Add category ' + proposal.category}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function Observations({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div
        style={{
          padding: '24px clamp(16px,2vw,28px) 40px',
          animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
        }}
      >
        {/* What the observations hold, by kind; Photos opens the photo
            collection. */}
        <div className="om-overview-wrap" style={{ marginBottom: '16px' }}>
          <div className="om-stat-boxes-3">
            <StatBox
              icon="sticky-note"
              label="Notes"
              content={{
                value: String(v.obsCounts.notes),
                unit: v.obsCounts.notes === 1 ? 'text note' : 'text notes',
              }}
            />
            <StatBox
              icon="mic"
              label="Recordings"
              content={{
                value: String(v.obsCounts.recordings),
                unit: v.obsCounts.recordings === 1 ? 'recording' : 'recordings',
              }}
            />
            <StatBox
              icon="image"
              label="Photos"
              content={{
                value: String(v.obsCounts.photos),
                unit: v.obsCounts.photos === 1 ? 'photo' : 'photos',
              }}
              onOpen={v.goPhotos}
              opens="the photo collection"
            />
          </div>
        </div>
        <div
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '14px 18px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ flex: '1 1 160px', minWidth: '150px' }}>
              <Select
                size="sm"
                aria-label="Filter by type"
                options={v.obsTypeFilterOptions}
                value={v.obsFilters.type}
                onChange={v.setObsFilter('type')}
              ></Select>
            </div>
            <div style={{ flex: '1 1 160px', minWidth: '150px' }}>
              <Select
                size="sm"
                aria-label="Filter by category"
                options={v.obsCatFilterOptions}
                value={v.obsFilters.cat}
                onChange={v.setObsFilter('cat')}
              ></Select>
            </div>
            <div style={{ flex: '1 1 160px', minWidth: '150px' }}>
              <Select
                size="sm"
                aria-label="Filter by severity"
                options={v.obsSevFilterOptions}
                value={v.obsFilters.sev}
                onChange={v.setObsFilter('sev')}
              ></Select>
            </div>
            <div style={{ flex: '1 1 160px', minWidth: '150px' }}>
              <Select
                size="sm"
                aria-label="Filter by location"
                options={v.obsLocFilterOptions}
                value={v.obsFilters.loc}
                onChange={v.setObsFilter('loc')}
              ></Select>
            </div>
            <div style={{ flex: '1 1 160px', minWidth: '150px' }}>
              <Select
                size="sm"
                aria-label="Filter by floor"
                options={v.obsFloorFilterOptions}
                value={v.obsFilters.floor}
                onChange={v.setObsFilter('floor')}
              ></Select>
            </div>
            <div style={{ flex: '1 1 160px', minWidth: '150px' }}>
              <Select
                size="sm"
                aria-label="Filter by status"
                options={v.obsStatusFilterOptions}
                value={v.obsFilters.status}
                onChange={v.setObsFilter('status')}
              ></Select>
            </div>
            {/* Swaps the list for the deleted observations and back (CP-08 AC14). */}
            <Button
              variant={v.obsShowDeleted ? 'tonal' : 'secondary'}
              size="sm"
              iconLeft={v.obsShowDeleted ? 'arrow-left' : IconRegistry.action.discard}
              onClick={() => v.setObsShowDeleted(!v.obsShowDeleted)}
            >
              {v.obsShowDeleted ? 'Back to observations' : `Deleted (${v.obsDeletedCount})`}
            </Button>
            {!!v.obsFiltering && (
              <Button variant="ghost" size="sm" onClick={v.clearObsFilters}>
                {'Clear filters'}
              </Button>
            )}
          </div>
          {!!v.obsWide && v.obsList.length > 0 && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: v.obsCols,
                  alignItems: 'center',
                  gap: '12px',
                  padding: '0 16px',
                  height: '36px',
                  background: 'var(--surface-header)',
                  borderBottom: '1px solid var(--border-default)',
                  fontSize: '11px',
                  fontWeight: '600',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                <span></span>
                <span>{'Category'}</span>
                <span>{'Location'}</span>
                <span>{'Summary'}</span>
                <span>{'Severity'}</span>
                <span>{'Status'}</span>
                <span style={{ textAlign: 'right' }}>{'Captured'}</span>
              </div>
            </>
          )}
          {v.obsList.map((o, index) => (
            <Fragment key={index}>
              <div>
                <div
                  data-i={o.key}
                  onClick={v.toggleObs}
                  style={o.rowStyle}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.currentTarget.click()
                    }
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Icon name={o.chevron} size={15}></Icon>
                  </span>
                  <span
                    style={{ minWidth: '0', display: 'flex', flexDirection: 'column', gap: '4px' }}
                  >
                    <span
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' }}
                    >
                      <Icon name={o.icon} size={15} color={o.color}></Icon>
                      <span
                        style={{
                          minWidth: '0',
                          fontSize: '15px',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {o.catLabel}
                      </span>
                      {!!o.deleted && <Badge tone="danger">Deleted</Badge>}
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      {o.typeLabel}
                    </span>
                    {!!v.obsStack && (
                      <>
                        <span
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            minWidth: '0',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {o.where}
                          </span>
                          <span
                            style={{
                              fontSize: '15px',
                              lineHeight: '22px',
                              color: 'var(--text-body)',
                              textWrap: 'pretty',
                            }}
                          >
                            {o.text}
                          </span>
                          <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            <Badge tone={o.sev} dot={true}>
                              {o.sevLabel}
                            </Badge>
                            <ObservationStatus o={o} />
                          </span>
                        </span>
                      </>
                    )}
                  </span>
                  {!!v.obsWide && (
                    <>
                      <span
                        style={{
                          minWidth: '0',
                          fontSize: '15px',
                          lineHeight: '22px',
                          color: 'var(--text-secondary)',
                          textWrap: 'pretty',
                        }}
                      >
                        {/* Wraps rather than truncating, so the floor stays visible. */}
                        {o.where}
                      </span>
                    </>
                  )}
                  {!!v.obsWide && (
                    <>
                      <span
                        style={{
                          minWidth: '0',
                          fontSize: '15px',
                          lineHeight: '22px',
                          color: 'var(--text-body)',
                          textWrap: 'pretty',
                        }}
                      >
                        {o.text}
                      </span>
                    </>
                  )}
                  {!!v.obsWide && (
                    <>
                      <span style={{ display: 'flex' }}>
                        <Badge tone={o.sev} dot={true}>
                          {o.sevLabel}
                        </Badge>
                      </span>
                      <span style={{ display: 'flex' }}>
                        <ObservationStatus o={o} />
                      </span>
                    </>
                  )}
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                    }}
                  >
                    {o.clock}
                  </span>
                </div>
                {!!o.open && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '18px',
                        padding: '18px 20px 18px clamp(20px,4vw,52px)',
                        background: 'var(--surface-sunken)',
                        borderLeft: '3px solid var(--action-primary)',
                        borderBottom: '1px solid var(--border-subtle)',
                        animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
                      }}
                    >
                      {/* Side by side, one column for each kind of content it
                          holds, so no column runs on while another is empty. */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
                          gap: '24px',
                        }}
                      >
                        {!!o.detail && (
                          <div style={{ minWidth: '0' }}>
                            <ColumnHead>
                              {'Detailed notes'}
                              <Badge
                                tone="neutral"
                                style={{
                                  marginLeft: 'var(--space-3)',
                                  textTransform: 'none',
                                  letterSpacing: 'normal',
                                }}
                              >
                                Text
                              </Badge>
                            </ColumnHead>
                            <p
                              style={{
                                margin: '10px 0 0',
                                fontSize: '15px',
                                lineHeight: '24px',
                                color: 'var(--text-body)',
                                maxWidth: '68ch',
                                textWrap: 'pretty',
                              }}
                            >
                              {o.detail}
                            </p>
                          </div>
                        )}
                        {(o.recordings.length > 0 || !!o.hasAudio) && (
                          <div style={{ minWidth: '0' }}>
                            <ColumnHead>
                              {'Recordings (' + (o.recordings.length || 1) + ')'}
                            </ColumnHead>
                            {o.recordings.map((r, index) => (
                              <section
                                key={r.id}
                                aria-label={r.name}
                                style={
                                  index
                                    ? {
                                        marginTop: '14px',
                                        paddingTop: '12px',
                                        borderTop: '1px solid var(--border-subtle)',
                                      }
                                    : { marginTop: '10px' }
                                }
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    flexWrap: 'wrap',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: 'var(--text-primary)',
                                  }}
                                >
                                  <Icon name="mic" size={14} color="#8f7dff"></Icon>
                                  <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                                    {r.name}
                                  </span>
                                  <Badge tone="neutral">Voice</Badge>
                                  <Badge tone={STATUS_BADGE[r.status].tone}>
                                    {STATUS_BADGE[r.status].label}
                                  </Badge>
                                  {!!r.correctedLabel && <Badge tone="neutral">Corrected</Badge>}
                                </div>
                                {r.status === 'failed' ? (
                                  <div role="status" style={{ marginTop: '8px' }}>
                                    <Callout
                                      tone="warning"
                                      title="Transcription failed"
                                      actions={
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          iconLeft="refresh-cw"
                                          onClick={r.retry}
                                        >
                                          {'Retry transcription'}
                                        </Button>
                                      }
                                    >
                                      {r.error}
                                    </Callout>
                                  </div>
                                ) : (
                                  <>
                                    <p
                                      style={{
                                        margin: '6px 0 0',
                                        fontSize: '15px',
                                        lineHeight: '24px',
                                        color: 'var(--text-body)',
                                        maxWidth: '68ch',
                                        textWrap: 'pretty',
                                      }}
                                    >
                                      {r.text}
                                    </p>
                                    {r.original !== null && (
                                      <details style={{ marginTop: '6px', fontSize: '14px' }}>
                                        <summary
                                          style={{
                                            cursor: 'pointer',
                                            color: 'var(--text-secondary)',
                                          }}
                                        >
                                          {'What Whisper wrote'}
                                        </summary>
                                        <p
                                          style={{
                                            margin: '6px 0 0',
                                            paddingLeft: '12px',
                                            borderLeft: '2px solid var(--ai-border)',
                                            color: 'var(--text-body)',
                                            maxWidth: '68ch',
                                          }}
                                        >
                                          {r.original}
                                        </p>
                                      </details>
                                    )}
                                    {!!r.correctedLabel && (
                                      <p style={stampStyle}>{r.correctedLabel}</p>
                                    )}
                                    {r.canCorrect && (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        iconLeft={IconRegistry.action.edit}
                                        onClick={r.correct}
                                        style={{ marginTop: '8px' }}
                                      >
                                        {'Edit transcript'}
                                      </Button>
                                    )}
                                  </>
                                )}
                                <audio
                                  controls
                                  preload="none"
                                  src={r.audioUrl}
                                  aria-label={'Play ' + r.name}
                                  style={{ display: 'block', width: '100%', marginTop: '8px' }}
                                />
                                {!!r.addedLabel && <p style={stampStyle}>{r.addedLabel}</p>}
                                {/* Kept to restore, never deleted (CP-08). */}
                                {!!r.remove && (
                                  <Button
                                    variant="danger-tonal"
                                    size="sm"
                                    iconLeft={IconRegistry.action.discard}
                                    aria-label={'Remove ' + r.name}
                                    onClick={r.remove}
                                    style={{ marginTop: '8px' }}
                                  >
                                    {'Remove'}
                                  </Button>
                                )}
                              </section>
                            ))}
                            {/* A sample observation's clip, played in this demo. */}
                            {!!o.hasAudio && (
                              <Button
                                variant="secondary"
                                size="sm"
                                iconLeft="mic"
                                onClick={v.playSampleAudio}
                                style={{ marginTop: '10px' }}
                              >
                                {o.audioLabel}
                              </Button>
                            )}
                          </div>
                        )}
                        {(o.media.length > 0 || !!o.proposal) && (
                          <div style={{ minWidth: '0' }}>
                            <ColumnHead>{'Photos (' + o.media.length + ')'}</ColumnHead>
                            <div
                              style={{
                                marginTop: '10px',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '10px',
                              }}
                            >
                              {o.media.map((m, index) => (
                                <div
                                  key={index}
                                  style={{
                                    width: '132px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '6px',
                                  }}
                                >
                                  {m.url ? (
                                    // The original photo, linked from its observation (CP-04 AC2).
                                    <a
                                      href={m.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      aria-label={'Open ' + m.name}
                                      style={{
                                        width: '132px',
                                        border: '1px solid var(--border-default)',
                                        borderRadius: '5px',
                                        background: 'var(--surface-card)',
                                        overflow: 'hidden',
                                        color: 'var(--text-muted)',
                                        textDecoration: 'none',
                                      }}
                                    >
                                      {/* ponytail: loads the original; serve smaller copies if lists grow long. */}
                                      <img
                                        src={m.url}
                                        alt=""
                                        loading="lazy"
                                        style={{ display: 'block', width: '100%', height: 'auto' }}
                                      />
                                      <span
                                        style={{
                                          display: 'block',
                                          padding: '4px 6px',
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: '12px',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {m.name}
                                      </span>
                                    </a>
                                  ) : (
                                    <div
                                      style={{
                                        width: '132px',
                                        border: '1px solid var(--border-default)',
                                        borderRadius: '5px',
                                        background: 'var(--surface-card)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        flexWrap: 'wrap',
                                        padding: '16px 8px',
                                      }}
                                    >
                                      <Icon
                                        name="image"
                                        size={18}
                                        color="var(--graphite-500)"
                                      ></Icon>
                                      <span
                                        style={{
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: '12px',
                                          color: 'var(--text-muted)',
                                        }}
                                      >
                                        {m.name}
                                      </span>
                                    </div>
                                  )}
                                  {/* Kept to restore, never deleted (CP-08). */}
                                  {!!m.remove && (
                                    <Button
                                      variant="danger-tonal"
                                      size="sm"
                                      iconLeft={IconRegistry.action.discard}
                                      aria-label={'Remove ' + m.name}
                                      onClick={m.remove}
                                    >
                                      {'Remove'}
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                            {o.media
                              .filter((m) => m.addedLabel)
                              .map((m, index) => (
                                <p key={index} style={stampStyle}>
                                  {m.addedLabel}
                                </p>
                              ))}
                            {/* What the photo service reads in them, beside the photos. */}
                            {!!o.proposal && <PhotoProposal o={o} proposal={o.proposal} />}
                          </div>
                        )}
                      </div>
                      {o.removedMedia.length > 0 && (
                        <details style={{ marginTop: '14px', fontSize: '14px' }}>
                          <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                            {'Removed media (' + o.removedMedia.length + ')'}
                          </summary>
                          <ul
                            aria-label="Removed media"
                            style={{
                              listStyle: 'none',
                              margin: '8px 0 0',
                              padding: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '10px',
                            }}
                          >
                            {o.removedMedia.map((m) => (
                              <li key={m.id} style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  <Icon
                                    name={m.kind === 'recordings' ? 'mic' : 'image'}
                                    size={14}
                                    color="var(--text-muted)"
                                  ></Icon>
                                  {m.kind === 'photos' && m.url ? (
                                    <a href={m.url} target="_blank" rel="noreferrer">
                                      {m.name}
                                    </a>
                                  ) : (
                                    <span style={{ overflowWrap: 'anywhere' }}>{m.name}</span>
                                  )}
                                  {!!m.restore && (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      iconLeft={IconRegistry.action.reinstate}
                                      aria-label={'Restore ' + m.name}
                                      onClick={m.restore}
                                    >
                                      {'Restore'}
                                    </Button>
                                  )}
                                </div>
                                {m.kind === 'recordings' && !!m.url && (
                                  <audio
                                    controls
                                    preload="none"
                                    src={m.url}
                                    aria-label={'Play ' + m.name}
                                    style={{ display: 'block', width: '100%', marginTop: '6px' }}
                                  />
                                )}
                                <p style={{ ...stampStyle, margin: '4px 0 0' }}>{m.removedLabel}</p>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {/* The observation's own actions in one row: who changed it
                          last, then Edit and Add media, and Delete apart at the
                          bottom right so it is not pressed by mistake. */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '8px',
                          paddingTop: '14px',
                          borderTop: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                          {!!o.deletedLabel && (
                            <p style={{ ...stampStyle, margin: 0 }}>{o.deletedLabel}</p>
                          )}
                          {!!o.editedLabel && (
                            <p style={{ ...stampStyle, margin: 0 }}>{o.editedLabel}</p>
                          )}
                        </div>
                        {!!o.hasStd && (
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft="book-marked"
                            onClick={v.openEvidenceSource}
                          >
                            {o.std}
                          </Button>
                        )}
                        {o.canChange && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              iconLeft={IconRegistry.action.edit}
                              onClick={o.editTags}
                            >
                              {'Edit'}
                            </Button>
                            {!!o.addMedia && (
                              <Button
                                variant="secondary"
                                size="sm"
                                iconLeft={IconRegistry.action.add}
                                onClick={o.addMedia}
                              >
                                {'Add media'}
                              </Button>
                            )}
                            <Button
                              variant="danger-tonal"
                              size="sm"
                              iconLeft={IconRegistry.action.discard}
                              onClick={o.deleteObs}
                              style={{ marginLeft: '8px' }}
                            >
                              {'Delete observation'}
                            </Button>
                          </>
                        )}
                        {o.canRestore && (
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft={IconRegistry.action.reinstate}
                            onClick={o.restoreObs}
                          >
                            {'Restore'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </Fragment>
          ))}
          {!!v.obsNoMatch && (
            <div style={{ padding: '48px 18px' }}>
              <EmptyState
                icon={IconRegistry.action.filter}
                title="No observations match those filters"
                description="Clear a filter or choose another value to see the other observations on file."
              ></EmptyState>
            </div>
          )}
          {!!v.obsNoDeleted && (
            <div style={{ padding: '48px 18px' }}>
              <EmptyState
                icon={IconRegistry.action.discard}
                title="No deleted observations"
                description="An observation you delete is listed here, where you can restore it. Choose Back to observations to see the observations on file."
              ></EmptyState>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '12px 16px',
              background: 'var(--surface-sunken)',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{v.obsCountLabel}</span>
            <span style={{ flex: '1' }}></span>
            <Button variant="ghost" size="sm" disabled={true}>
              {'Previous'}
            </Button>
            <Button variant="secondary" size="sm" onClick={v.obsNext}>
              {'Next'}
            </Button>
          </div>
        </div>
      </div>
      <TagDialog v={v} />
      {v.obsDialog?.kind === 'transcript' && !!v.obsDialog.recording && (
        <TranscriptDialog
          key={v.obsDialog.key + v.obsDialog.recording.id}
          v={v}
          dialog={v.obsDialog}
        />
      )}
      {v.obsDialog?.kind === 'delete' && (
        <DeleteDialog key={v.obsDialog.key} v={v} dialog={v.obsDialog} />
      )}
      {v.obsDialog?.kind === 'addMedia' && (
        <AddMediaDialog key={v.obsDialog.key} v={v} dialog={v.obsDialog} />
      )}
      {v.obsDialog?.kind === 'removeMedia' && !!v.obsDialog.media && (
        <RemoveMediaDialog
          key={v.obsDialog.key + v.obsDialog.media.id}
          v={v}
          dialog={v.obsDialog}
        />
      )}
    </>
  )
}
