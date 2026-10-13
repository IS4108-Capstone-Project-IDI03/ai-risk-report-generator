import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type * as React from 'react'
import {
  Badge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  IconRegistry,
  Tag,
} from '../../../design-system'
import { AddMediaDialog } from '../components/AddMediaDialog'
import { FilterMenu } from '../components/FilterMenu'
import { FoldHeading } from '../components/FoldHeading'
import { LocationForm, RemoveLocationDialog } from '../components/LocationSheet'
import { StatBox } from '../components/StatBox'
import { DeleteDialog, RemoveMediaDialog, TranscriptDialog } from '../components/ObservationDialogs'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
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

// A photo's name that opens the photo in a popup.
function PhotoLink({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button
      variant="link"
      size="sm"
      onClick={onClick}
      style={{ height: 'auto', fontSize: 'inherit', fontWeight: 'inherit', whiteSpace: 'normal' }}
    >
      {name}
    </Button>
  )
}

function PhotoProposal({
  o,
  proposal,
  onView,
}: {
  o: Row
  proposal: NonNullable<Row['proposal']>
  onView: (photo: ViewedPhoto) => void
}) {
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
                    <PhotoLink
                      name={m.name}
                      onClick={() => onView({ name: m.name, url: m.url!, context: o.where })}
                    />
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

// One observation's row, and its details once opened (CP-08).
function ObservationRow({
  v,
  o,
  onView,
}: {
  v: AssessmentWorkflow
  o: Row
  onView: (photo: ViewedPhoto) => void
}) {
  return (
    <div>
      <div
        data-i={o.key}
        data-landing={o.key === v.obsLandingRow || undefined}
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
        <span style={{ minWidth: '0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' }}>
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
            {!!o.isNew && <Badge tone="info">New</Badge>}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{o.typeLabel}</span>
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
                {!v.obsByLocation && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {o.where}
                  </span>
                )}
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
        {!!v.obsWide && !v.obsByLocation && (
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
              {/* Wraps rather than truncating, so the whole place stays visible. */}
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
                  <ColumnHead>{'Recordings (' + (o.recordings.length || 1) + ')'}</ColumnHead>
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
                        <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{r.name}</span>
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
                          {!!r.correctedLabel && <p style={stampStyle}>{r.correctedLabel}</p>}
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
                          // The original photo, opened from its observation (CP-04 AC2).
                          <button
                            type="button"
                            aria-label={'Open ' + m.name}
                            onClick={() => onView({ name: m.name, url: m.url!, context: o.where })}
                            style={{
                              width: '132px',
                              padding: 0,
                              border: '1px solid var(--border-default)',
                              borderRadius: '5px',
                              background: 'var(--surface-card)',
                              overflow: 'hidden',
                              color: 'var(--text-muted)',
                              textAlign: 'left',
                              cursor: 'zoom-in',
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
                          </button>
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
                            <Icon name="image" size={18} color="var(--graphite-500)"></Icon>
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
                  {!!o.proposal && <PhotoProposal o={o} proposal={o.proposal} onView={onView} />}
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
                          <PhotoLink
                            name={m.name}
                            onClick={() => onView({ name: m.name, url: m.url!, context: o.where })}
                          />
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
                {!!o.deletedLabel && <p style={{ ...stampStyle, margin: 0 }}>{o.deletedLabel}</p>}
                {!!o.editedLabel && <p style={{ ...stampStyle, margin: 0 }}>{o.editedLabel}</p>}
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
  )
}

type ObservationGroupView = AssessmentWorkflow['obsGroups'][number]
type ObservationPlaceView = ObservationGroupView['levels'][number]['locations'][number]

// A building (or Elsewhere on site), folding away under its heading, then
// each level's locations with their observations (CP-16).
function ObservationGroup({
  v,
  group,
  onView,
}: {
  v: AssessmentWorkflow
  group: ObservationGroupView
  onView: (photo: ViewedPhoto) => void
}) {
  const id = useId()
  return (
    <section aria-label={group.title}>
      <FoldHeading
        title={group.title}
        countLabel={group.countLabel}
        open={group.open}
        controls={id}
        onToggle={group.toggle}
      />
      {group.open && (
        <div id={id}>
          {group.levels.map((level) => (
            <div key={level.title ?? ''}>
              {!!level.title && (
                <div
                  style={{
                    padding: '12px 16px 4px',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: 'var(--text-muted)',
                  }}
                >
                  {level.title}
                </div>
              )}
              {level.locations.map((l) => (
                <ObservationPlace key={l.id} v={v} place={l} onView={onView} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// A location: its name and how many observations it holds, Add observation
// (capture opens there), Edit for the assigned engineer and Remove while
// nothing is saved there, then its observations, newest first (CP-16). Back
// from capture, the one it returns to takes focus.
function ObservationPlace({
  v,
  place: l,
  onView,
}: {
  v: AssessmentWorkflow
  place: ObservationPlaceView
  onView: (photo: ViewedPhoto) => void
}) {
  return (
    <div
      role="group"
      aria-label={l.label}
      data-landing={l.landing || undefined}
      tabIndex={l.landing ? -1 : undefined}
      // The focus ring is drawn inside, clear of the headings around it.
      style={{ scrollMarginTop: '16px', outlineOffset: '-2px' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <Icon name="map-pin" size={16} color="var(--action-primary)" />
        <h3
          style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}
        >
          {l.name}
        </h3>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{l.countLabel}</span>
        <span style={{ flex: '1' }}></span>
        {!!l.addObservation && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft="plus"
            aria-label={'Add observation at ' + l.label}
            onClick={l.addObservation}
          >
            {'Add observation'}
          </Button>
        )}
        {!!l.edit && <IconButton icon="pencil" label={'Edit ' + l.label} onClick={l.edit} />}
        {!!l.remove && <IconButton icon="trash-2" label={'Remove ' + l.label} onClick={l.remove} />}
      </div>
      {l.items.map((o) => (
        <ObservationRow key={o.key} v={v} o={o} onView={onView} />
      ))}
    </div>
  )
}

export function Observations({ v }: { v: AssessmentWorkflow }) {
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  // Back from capture, the list scrolls once to where the engineer was, as
  // soon as it is listed, and focus goes there (CP-16).
  const page = useRef<HTMLDivElement>(null)
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || !v.obsReturning) return
    const target = page.current?.querySelector<HTMLElement>('[data-landing]')
    if (!target) return
    landed.current = true
    target.scrollIntoView?.({ block: 'start' })
    target.focus({ preventScroll: true })
  })
  return (
    <>
      <div
        ref={page}
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
        {/* The card no longer clips, so the Filters panel can hang below a
            short list; its footer rounds the bottom corners instead. */}
        <div
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {/* Newest first unless grouped by location, the filters behind one
              button, the deleted ones, and a location added without capturing
              (CP-08, CP-16). The deleted ones are always newest first. */}
          <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                padding: '14px 18px',
              }}
            >
              {/* Says what pressing it does, so its text changes with the list. */}
              {!v.obsShowDeleted && (
                <Button size="sm" variant="secondary" onClick={v.toggleObsByLocation}>
                  {v.obsByLocation ? 'Show newest first' : 'Group by location'}
                </Button>
              )}
              <FilterMenu v={v} />
              {/* Swaps the list for the deleted observations and back (CP-08 AC14). */}
              <Button
                variant={v.obsShowDeleted ? 'tonal' : 'secondary'}
                size="sm"
                iconLeft={v.obsShowDeleted ? 'arrow-left' : IconRegistry.action.discard}
                onClick={() => v.setObsShowDeleted(!v.obsShowDeleted)}
              >
                {v.obsShowDeleted ? 'Back to observations' : `Deleted (${v.obsDeletedCount})`}
              </Button>
              <span style={{ flex: '1' }}></span>
              {!v.obsShowDeleted && !!v.obsAddLocation && (
                <Button variant="secondary" size="sm" iconLeft="map-pin" onClick={v.obsAddLocation}>
                  {'Add location'}
                </Button>
              )}
            </div>
            {/* What the filters are set to, each removable, while any is. */}
            {v.obsFilterChips.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  padding: '0 18px 14px',
                }}
              >
                {v.obsFilterChips.map((chip) => (
                  <Tag key={chip.key} onRemove={chip.remove} removeLabel={'Remove ' + chip.label}>
                    {chip.label}
                  </Tag>
                ))}
                <Button variant="ghost" size="sm" onClick={v.clearObsFilters}>
                  {'Clear filters'}
                </Button>
              </div>
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
                {!v.obsByLocation && <span>{'Location'}</span>}
                <span>{'Summary'}</span>
                <span>{'Severity'}</span>
                <span>{'Status'}</span>
                <span style={{ textAlign: 'right' }}>{'Captured'}</span>
              </div>
            </>
          )}
          {v.obsByLocation
            ? v.obsGroups.map((g) => (
                <ObservationGroup key={g.key} v={v} group={g} onView={setViewing} />
              ))
            : v.obsList.map((o) => <ObservationRow key={o.key} v={v} o={o} onView={setViewing} />)}
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
          {!!v.obsNone && (
            <div style={{ padding: '48px 18px' }}>
              <EmptyState
                icon="camera"
                title="No observations yet"
                description="Observations captured on site are listed here, with their notes, recordings and photos."
                action={
                  v.canEdit &&
                  v.canCapture && (
                    <Button variant="secondary" iconLeft="plus" onClick={v.goField}>
                      {'Add observation'}
                    </Button>
                  )
                }
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
              borderRadius: '0 0 8px 8px',
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
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
      <TagDialog v={v} />
      {/* Adding or changing a location here (CP-16), as in the capture picker. */}
      {v.obsLocFormOpen && (
        <Dialog
          className={v.phone ? 'ds-dialog-sheet' : undefined}
          title={v.locEditing ? 'Edit location' : 'Add a location'}
          width={480}
          onClose={v.lfBusy ? undefined : v.cancelLocationForm}
        >
          <LocationForm v={v} />
        </Dialog>
      )}
      {!!v.locRemoveLabel && <RemoveLocationDialog key={v.locRemoveLabel} v={v} />}
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
