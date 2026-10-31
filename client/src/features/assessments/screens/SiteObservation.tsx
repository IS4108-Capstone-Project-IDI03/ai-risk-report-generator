import { Fragment, useId } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Icon,
  IconRegistry,
  Textarea,
} from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { CaptureSessionNotice } from '../components/CaptureSessionNotice'
import { CategoryPicker } from '../components/CategoryPicker'
import { ChecklistSheet } from '../components/ChecklistSheet'
import { LocationPicker, RemoveLocationDialog } from '../components/LocationSheet'
import { PhotoPickers, PhotoThumb, ReadyItem } from '../components/MediaPickers'
import { SeverityPicker } from '../components/SeverityPicker'

const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's')
// How many a mode holds, beside its name on the switcher.
const countStyle = { fontSize: '13px', color: 'var(--text-muted)', fontWeight: '400' }
const card: CSSProperties = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  boxShadow: 'var(--shadow-sm)',
}

// One observation at a time: where, what was seen (as a note, recordings,
// photos or pages of handwritten notes), its tags, then Save. It is a page of the Observations tab, under
// the workspace's header and tabs, with Back to observations above it; on a
// phone the top bar's ← is the way back instead (AssessmentApp). On a wide
// screen the tags and Save sit in a panel beside the form; otherwise all in
// one column, with Save pinned to the bottom.
export function SiteObservation({ v }: { v: AssessmentWorkflow }) {
  const detailId = useId()
  const split = v.captureSplit
  const width = split ? '1200px' : '720px'
  const form = (
    <>
      <LocationPicker v={v} />
      {v.canOpenChecklist && <ChecklistBar v={v} />}
      {/* Each mode says what it holds, so nothing waits unseen behind another. */}
      <div
        role="group"
        aria-label="Capture as"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0,1fr))',
          background: 'var(--surface-card)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <button
          type="button"
          onClick={v.modeNote}
          style={v.tabNoteStyle}
          aria-pressed={v.isNoteMode}
          aria-label={v.noteWritten ? 'Note, written' : 'Note'}
        >
          {'Note'}
          {v.noteWritten && <Icon name="check" size={14} color="var(--action-primary)" />}
        </button>
        <button
          type="button"
          onClick={v.modeVoice}
          style={v.tabVoiceStyle}
          aria-pressed={v.isVoiceMode}
          aria-label={v.voiceCount ? 'Voice, ' + plural(v.voiceCount, 'recording') : 'Voice'}
        >
          {'Voice'}
          {v.voiceCount > 0 && <span style={countStyle}>{v.voiceCount}</span>}
        </button>
        <button
          type="button"
          onClick={v.modePhoto}
          style={v.tabPhotoStyle}
          aria-pressed={v.isPhotoMode}
          aria-label={v.photoCount ? 'Photo, ' + plural(v.photoCount, 'photo') : 'Photo'}
        >
          {'Photo'}
          {v.photoCount > 0 && <span style={countStyle}>{v.photoCount}</span>}
        </button>
        <button
          type="button"
          onClick={v.modeScan}
          style={v.tabScanStyle}
          aria-pressed={v.isScanMode}
          aria-label={v.pageCount ? 'Scan, ' + plural(v.pageCount, 'page') : 'Scan'}
        >
          {'Scan'}
          {v.pageCount > 0 && <span style={countStyle}>{v.pageCount}</span>}
        </button>
      </div>
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!!v.isNoteMode && (
          <Textarea
            label="Note"
            rows={5}
            maxLength={5000}
            placeholder="What did you see? Write as you would for the record."
            value={v.fNote}
            onChange={v.setFNote}
          ></Textarea>
        )}
        {!!v.isVoiceMode && (
          <>
            <div
              style={{
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border-default)',
                borderRadius: '8px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '3px',
                  height: '44px',
                }}
              >
                {v.waveBars.map((b, index) => (
                  <Fragment key={index}>
                    <span style={b.style}></span>
                  </Fragment>
                ))}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '25px',
                  lineHeight: '31px',
                  fontWeight: '700',
                  color: 'var(--text-primary)',
                }}
              >
                {v.fClock}
              </div>
              <button type="button" onClick={v.toggleRec} style={v.recStyle}>
                {v.recLabel}
              </button>
              <span
                style={{
                  fontSize: '14px',
                  lineHeight: '20px',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}
              >
                {v.recHint}
              </span>
              {!!v.liveVoice && (
                <label
                  className="ds-choice"
                  style={{
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: v.recBusy ? 'var(--text-muted)' : 'var(--action-primary)',
                    cursor: v.recBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Icon name="upload" size={16} />
                  {'Upload audio files'}
                  <input
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={v.uploadRecording}
                    disabled={v.recBusy}
                  />
                </label>
              )}
            </div>
            {!!v.fVoiceError && (
              <div role="alert">
                <Callout tone="warning" title={v.fVoiceError.title}>
                  {v.fVoiceError.message}
                </Callout>
              </div>
            )}
            {!!v.hasTranscript && (
              <>
                <div
                  style={{
                    background: 'var(--ai-bg)',
                    border: '1px solid var(--ai-border)',
                    borderRadius: '8px',
                    padding: '14px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '8px',
                    }}
                  >
                    <Badge tone="ai" icon="sparkles">
                      {'Transcribed'}
                    </Badge>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {'00:47'}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: '0',
                      fontFamily: 'var(--font-serif)',
                      fontSize: '15px',
                      lineHeight: '24px',
                      color: 'var(--text-body)',
                    }}
                  >
                    {v.fTranscriptText}
                  </p>
                  <div style={{ marginTop: '12px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft="pencil"
                      onClick={v.transcriptToNote}
                    >
                      {'Edit as text note'}
                    </Button>
                  </div>
                </div>
              </>
            )}
            {v.fClips.length > 0 && (
              <DraftList label="Recordings" count={v.fClips.length}>
                {v.fClips.map((clip) => (
                  <ReadyItem
                    key={clip.id}
                    icon={clip.length ? 'mic' : 'file-audio'}
                    title={clip.name}
                    detail={clip.length}
                  >
                    <audio
                      controls
                      src={clip.url}
                      aria-label={'Play ' + clip.name}
                      style={{ height: '32px', flex: '1 1 180px', minWidth: 0 }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft="trash-2"
                      aria-label={'Remove ' + clip.name}
                      disabled={v.recBusy}
                      onClick={() => v.removeClip(clip)}
                    />
                  </ReadyItem>
                ))}
              </DraftList>
            )}
          </>
        )}
        {!!v.isPhotoMode && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <PhotoPickers onChange={v.addPhotos} busy={v.fSaving} />
              <span style={{ fontSize: '14px', lineHeight: '20px', color: 'var(--text-muted)' }}>
                {v.photoHint}
              </span>
              {!!v.fPhotoError && (
                <div role="alert">
                  <Callout tone="warning" title="Not a JPG or PNG">
                    {v.fPhotoError}
                  </Callout>
                </div>
              )}
            </div>
            {v.fPhotos.length > 0 && (
              <DraftList label="Photos" count={v.fPhotos.length}>
                {v.fPhotos.map((photo) => (
                  <ReadyItem key={photo.id} icon="image" title={photo.name}>
                    <PhotoThumb url={photo.url} />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft="trash-2"
                      aria-label={'Remove ' + photo.name}
                      disabled={v.fSaving}
                      onClick={() => v.removePhoto(photo)}
                    />
                  </ReadyItem>
                ))}
              </DraftList>
            )}
          </>
        )}
        {/* Pages of handwritten notes (CP-19): photographed one page per photo,
            and transcribed word for word once saved, as a recording is. */}
        {!!v.isScanMode && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <PhotoPickers
                onChange={v.addPages}
                busy={v.fSaving}
                takeLabel="Photograph a page"
                chooseLabel="Choose pages"
              />
              <span style={{ fontSize: '14px', lineHeight: '20px', color: 'var(--text-muted)' }}>
                {v.pageHint}
              </span>
              {!!v.fPageError && (
                <div role="alert">
                  <Callout tone="warning" title="Not a JPG or PNG">
                    {v.fPageError}
                  </Callout>
                </div>
              )}
            </div>
            {v.fPages.length > 0 && (
              <DraftList label="Pages" count={v.fPages.length}>
                {v.fPages.map((page) => (
                  <ReadyItem
                    key={page.id}
                    icon={IconRegistry.evidence.handwriting}
                    title={page.name}
                  >
                    <PhotoThumb url={page.url} />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft="trash-2"
                      aria-label={'Remove ' + page.name}
                      disabled={v.fSaving}
                      onClick={() => v.removePage(page)}
                    />
                  </ReadyItem>
                ))}
              </DraftList>
            )}
          </>
        )}
      </div>
    </>
  )
  const detail = (
    <section
      aria-labelledby={detailId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        borderTop: split ? undefined : '1px solid var(--border-subtle)',
      }}
    >
      <span
        id={detailId}
        style={{
          fontSize: '13px',
          fontWeight: '600',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {'Observation detail'}
      </span>
      <CategoryPicker cats={v.fCats} onToggle={v.toggleFCat} />
      <SeverityPicker value={v.fSev} onChange={v.setFSev} />
    </section>
  )
  return (
    <>
      <div
        style={{
          padding: '24px clamp(16px,2vw,28px) 40px',
          animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
        }}
      >
        {/* A phone names the page in its top bar, with its ← beside it. */}
        {!v.phone && (
          <div style={{ maxWidth: width, marginBottom: '16px' }}>
            <Button variant="link" iconLeft="arrow-left" onClick={v.leaveCapture}>
              {'Back to observations'}
            </Button>
            <h2
              style={{
                margin: '8px 0 0',
                fontSize: '22px',
                lineHeight: '28px',
                fontWeight: '700',
                letterSpacing: '-0.01em',
                color: 'var(--text-primary)',
              }}
            >
              {'New observation'}
            </h2>
          </div>
        )}
        {v.capture?.status === 'unavailable' && (
          <div style={{ maxWidth: width, marginBottom: '20px' }}>
            <CaptureSessionNotice
              capture={v.capture}
              reference={v.captureRef}
              onRetry={v.retryCapture}
            />
          </div>
        )}
        {/* The form's card does not clip, so the location dropdown can hang
            below a short form. */}
        {split ? (
          <div
            style={{
              maxWidth: width,
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 344px',
              gap: '20px',
              alignItems: 'start',
            }}
          >
            <div style={card}>{form}</div>
            {/* Stays in view while the form scrolls. */}
            <div style={{ ...card, overflow: 'clip', position: 'sticky', top: '24px' }}>
              {detail}
              <CaptureActions v={v} stacked />
            </div>
          </div>
        ) : (
          <div style={{ ...card, maxWidth: width }}>
            {form}
            {detail}
            <CaptureActions v={v} stacked={false} />
          </div>
        )}
      </div>
      {/* Above the location picker, so it opens fresh for each location. */}
      {!!v.locRemoveLabel && <RemoveLocationDialog key={v.locRemoveLabel} v={v} />}
      {/* Mounted only while open, so it loads the checklist as it is now. */}
      {v.checklistOpen && <ChecklistSheet v={v} />}
      {v.leaveOpen && (
        <Dialog
          title="Leave without saving?"
          description={'Not saved yet: ' + v.unsavedLabel + '. Leaving discards this observation.'}
          width={480}
          onClose={v.closeLeave}
          footer={
            <>
              <Button variant="secondary" onClick={v.closeLeave}>
                {'Keep editing'}
              </Button>
              <Button variant="danger" onClick={v.discardAndLeave}>
                {'Discard and leave'}
              </Button>
            </>
          }
        />
      )}
    </>
  )
}

// Under the location bar: the checklist, to answer its items here (CP-31); or,
// while a Differs is recorded in full capture, the item it answers, with the
// way back to the checklist that leaves it unanswered.
function ChecklistBar({ v }: { v: AssessmentWorkflow }) {
  return (
    <div
      style={{
        padding: '10px 16px',
        background: 'var(--surface-card)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      {v.fChecklistItem ? (
        <section
          aria-label="Recording a difference"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px 12px',
            borderRadius: '6px',
            background: 'var(--status-moderate-bg)',
            color: 'var(--status-moderate-fg)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <Icon name="equal-not" size={14} />
            {'Recording a difference for:'}
          </span>
          <span style={{ fontSize: '14px', color: 'var(--text-body)' }}>
            {v.fChecklistItem.text}
          </span>
          <span style={{ fontSize: '13px' }}>
            {'Record what you saw, then save. It is answered as Differs.'}
          </span>
          <Button
            variant="link"
            size="sm"
            iconLeft="arrow-left"
            onClick={v.backToChecklist}
            style={{ alignSelf: 'flex-start' }}
          >
            {'Back to checklist'}
          </Button>
        </section>
      ) : (
        <Button variant="secondary" iconLeft="list-checks" onClick={v.openChecklist}>
          {'Open checklist'}
        </Button>
      )}
    </div>
  )
}

// Save observation, where the engineer finishes: under the tags in the side
// panel, or pinned to the bottom of the screen, above a phone's home
// indicator. Leaving is Back to observations', at the top.
function CaptureActions({ v, stacked }: { v: AssessmentWorkflow; stacked: boolean }) {
  return (
    <div
      style={{
        // The card's bottom corners, as the one-column card does not clip.
        ...(!stacked && { position: 'sticky', bottom: 0, zIndex: 1, borderRadius: '0 0 8px 8px' }),
        padding: stacked ? '14px 20px' : '14px 20px calc(14px + env(safe-area-inset-bottom))',
        background: 'var(--surface-sunken)',
        borderTop: '1px solid var(--border-default)',
      }}
    >
      {!!v.fToast && (
        <div
          role="status"
          style={{
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            borderRadius: '5px',
            background: v.fToast.warn ? 'var(--status-moderate-bg)' : 'var(--status-low-bg)',
            color: v.fToast.warn ? 'var(--status-moderate-fg)' : 'var(--status-low-fg)',
            fontSize: '14px',
            animation: 'omSlide 180ms cubic-bezier(.2,0,.2,1)',
          }}
        >
          <Icon name={v.fToast.warn ? 'triangle-alert' : 'circle-check'} size={14}></Icon>
          <span>{v.fToast.text}</span>
        </div>
      )}
      {!!v.fSaveError && (
        <div role="alert" style={{ marginBottom: '10px' }}>
          <Callout tone="warning" title={v.fSaveError.title}>
            {v.fSaveError.message}
          </Callout>
        </div>
      )}
      <Button
        variant="primary"
        size={v.phone ? 'lg' : 'md'}
        fullWidth={stacked || v.phone}
        iconLeft="check"
        loading={v.fSaving || v.captureStarting}
        onClick={v.saveObservation}
      >
        {'Save observation'}
      </Button>
    </div>
  )
}

// What one mode adds to the observation, waiting for Save observation.
function DraftList({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: ReactNode
}) {
  const labelId = useId()
  return (
    <section
      aria-labelledby={labelId}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '13px',
          fontWeight: '600',
          color: 'var(--text-secondary)',
        }}
      >
        <span id={labelId}>{label}</span>
        <span>{count}</span>
      </div>
      {children}
    </section>
  )
}
