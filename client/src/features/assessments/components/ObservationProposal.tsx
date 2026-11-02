// What the AI suggests from an observation (CP-05, CP-21), on its page
// (CP-22): suggested categories, each a full-width row with its reason, the
// quotes it rests on and Add. Nothing is read until the engineer asks: before
// that it is the same card with Get AI proposal (CP-21, restored round 3).
// The description of its photos (PhotoReading) sits under the photos in the
// pictures panel (round 6). Rendered by screens/ObservationPage.tsx.
import type { ReactNode } from 'react'
import { Icon } from '../../../design-system'
import type { ObservationChange } from '../useAssessmentWorkflow'
import type { ObservationRowView } from '../useObservationsView'
import { CategoryMark } from './ObservationMarks'
import './ai-suggestions.css'

type Proposal = NonNullable<ObservationRowView['proposal']>
type Read = Exclude<Proposal, { status: 'unread' }>

// `save` is the page's save queue; `busy` while a save is on its way, when a
// suggestion would be built on the observation as it was before that save.
type Saving = { save: (change: ObservationChange) => Promise<boolean>; busy: boolean }

export function ObservationProposal({ proposal: p, save, busy }: { proposal: Proposal } & Saving) {
  // a. Not read yet: the card's header, with the one way to ask.
  if (p.status === 'unread')
    return (
      <section className="ob-card ai" aria-label="AI suggestions">
        <header className="ai-head ai-head--ask">
          <span className="ai-badge" aria-hidden="true">
            <Icon name="sparkles" size={16} />
          </span>
          <h3 className="ai-title">{'AI Suggestions'}</h3>
          <button
            type="button"
            className="ob-button ob-button--tinted ai-ask"
            disabled={busy}
            onClick={p.read}
          >
            <Icon name="sparkles" size={16} />
            {'Get AI proposal'}
          </button>
        </header>
      </section>
    )
  return <ReadProposal proposal={p} save={save} busy={busy} />
}

// b. Read (or being read): the categories. The photos' description sits under
// the photos themselves (PhotoReading, round 6).
function ReadProposal({ proposal: p, save, busy }: { proposal: Read } & Saving) {
  return (
    <section className="ob-card ai" aria-label="AI suggestions">
      <header className="ai-head">
        <span className="ai-badge" aria-hidden="true">
          <Icon name="sparkles" size={16} />
        </span>
        <div>
          <h3 className="ai-title">{'AI Suggestions'}</h3>
          <p className="ai-sub">{'Nothing changes on this observation until you add it.'}</p>
        </div>
      </header>

      {/* The categories, each with why and Add. */}
      <Group
        title="Categories"
        status={p.status}
        error={p.error}
        outOfDate={!!p.outOfDate}
        again={p.readCategories}
        againLabel="Suggest again"
      >
        {p.categories.length ? (
          <ul className="ai-list" aria-label="Suggested categories">
            {p.categories.map((c) => (
              <li key={c.category} className="ai-row">
                <CategoryMark cats={[c.category]} />
                <div className="ai-row-main">
                  <span className="ai-row-name">{c.category}</span>
                  {!!c.reason && <p className="ai-row-text">{c.reason}</p>}
                  {c.evidence.length > 0 && (
                    <ul className="ai-quotes" aria-label={'Evidence for ' + c.category}>
                      {c.evidence.map((e, i) => (
                        <li key={i}>
                          <q>{e.quote}</q>
                          <span>{e.item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="ai-row-action">
                  {c.add ? (
                    <button
                      type="button"
                      className="ob-button ob-button--tinted ob-button--small"
                      aria-label={'Add ' + c.category}
                      disabled={busy}
                      onClick={() => void save(c.add!)}
                    >
                      <Icon name="plus" size={14} />
                      {'Add'}
                    </button>
                  ) : (
                    c.added && (
                      <span className="ai-added">
                        <Icon name="check" size={14} />
                        {'Added'}
                      </span>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ai-empty">{'No category suggested.'}</p>
        )}
      </Group>

      {p.sample && (
        <p className="ai-foot">{'A sample suggestion: this demo has no capture session.'}</p>
      )}
    </section>
  )
}

// c. What the AI read in the photos, with a way to copy it into the note, under
// the photos (components/MediaPanel.tsx); nothing until the observation is read.
export function PhotoReading({ proposal: p, save, busy }: { proposal: Proposal } & Saving) {
  if (p.status === 'unread') return null
  const photos = p.photos
  if (!photos)
    return p.readDescription ? (
      <div className="ai-photos">
        <button
          type="button"
          className="ob-button ob-button--tinted ob-button--small"
          onClick={p.readDescription}
        >
          <Icon name="sparkles" size={14} />
          {'Describe photos'}
        </button>
      </div>
    ) : null
  return (
    <div className="ai-photos">
      <Group
        title="From the photos"
        status={photos.status}
        error={photos.error}
        outOfDate={photos.outOfDate}
        again={p.readDescription}
        againLabel="Describe again"
      >
        <div className="ai-describe">
          <p className="ai-row-text">{photos.description}</p>
          {!!p.addToNote && (
            <button
              type="button"
              className="ob-button ob-button--tinted ob-button--small"
              disabled={busy}
              onClick={() => void save(p.addToNote!)}
            >
              <Icon name="copy-plus" size={14} />
              {'Copy into note'}
            </button>
          )}
        </div>
      </Group>
    </div>
  )
}

// One part under its heading, as it stands: being read, failed with Retry, or
// written. Asking again sits in the heading, with a quiet note when the
// evidence changed since.
function Group({
  title,
  status,
  error,
  outOfDate,
  again,
  againLabel,
  children,
}: {
  title: string
  status: string
  error: string | null
  outOfDate: boolean
  again: (() => void) | null
  againLabel: string
  children: ReactNode
}) {
  const failed = status === 'failed'
  return (
    <div className="ai-group">
      <div className="ai-group-head">
        <h4>
          {/* The AI's mark, so its reading never passes for the engineer's. */}
          <Icon name="sparkles" size={13} color="var(--ai-fg)" />
          {title}
        </h4>
        {status !== 'interpreting' && !!again && (
          <span className="ai-again">
            {outOfDate && !failed && <span>{'Its evidence changed since.'}</span>}
            <button type="button" className="ob-button ob-button--small" onClick={again}>
              <Icon name="refresh-cw" size={13} />
              {failed ? 'Retry' : againLabel}
            </button>
          </span>
        )}
      </div>
      {status === 'interpreting' ? (
        <p className="ai-status">
          <Icon name="loader" size={14} className="ob-spin" />
          {'Reading…'}
        </p>
      ) : failed ? (
        <p className="ai-status ai-status--problem" role="status">
          <Icon name="circle-alert" size={14} />
          {error}
        </p>
      ) : (
        children
      )}
    </div>
  )
}
