import { Button, EmptyState, Icon } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

// The assessment's photo collection (CP-04 AC3): every site photograph saved
// with its observations, except a deleted observation's. The report's
// photograph appendix (EX-01) is to draw on the same photos. Each is shown
// whole, at its real aspect ratio, as evidence.
export function Photos({ v }: { v: AssessmentWorkflow }) {
  const photos = v.photoCollection
  return (
    <div
      style={{
        padding: '24px clamp(16px,2vw,28px) 40px',
        animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
      }}
    >
      {/* Opened from the Observations tab's Photos box, so it leads back there. */}
      <Button
        variant="ghost"
        size="sm"
        iconLeft="arrow-left"
        onClick={v.goObservations}
        style={{ marginBottom: '10px' }}
      >
        {'Back to observations'}
      </Button>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '6px',
        }}
      >
        <span
          style={{
            fontSize: '19px',
            lineHeight: '28px',
            fontWeight: '600',
            color: 'var(--text-primary)',
          }}
        >
          {'Site photographs'}
        </span>
      </div>
      <p
        style={{
          margin: '0 0 16px',
          fontSize: '14px',
          lineHeight: '20px',
          color: 'var(--text-muted)',
          maxWidth: '68ch',
        }}
      >
        {
          'Every photograph saved with this assessment’s observations, as taken. Photographs of a deleted observation are left out until it is restored.'
        }
      </p>
      {photos.length === 0 ? (
        <div
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px',
          }}
        >
          <EmptyState
            icon="image"
            title="No photographs yet"
            description="Photographs appear here once they are saved with an observation on site."
          />
        </div>
      ) : (
        <ul
          aria-label="Site photographs"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            alignItems: 'start',
            gap: '16px',
          }}
        >
          {photos.map((photo) => (
            <li key={photo.key}>
              <figure
                style={{
                  margin: 0,
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '8px',
                  boxShadow: 'var(--shadow-sm)',
                  overflow: 'hidden',
                }}
              >
                {photo.url ? (
                  <a
                    href={photo.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={'Open ' + photo.name}
                  >
                    {/* ponytail: loads the original; serve smaller copies if collections grow large. */}
                    <img
                      src={photo.url}
                      alt=""
                      loading="lazy"
                      style={{ display: 'block', width: '100%', height: 'auto' }}
                    />
                  </a>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      height: '120px',
                      background: 'var(--surface-sunken)',
                    }}
                  >
                    <Icon name="image" size={18} color="var(--graphite-500)" />
                  </div>
                )}
                <figcaption
                  style={{
                    padding: '10px 12px',
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <span
                    style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' }}
                  >
                    {photo.where}
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {photo.cat}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {photo.name + ' · ' + photo.time}
                  </span>
                  <div style={{ marginTop: '6px' }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft="link"
                      onClick={photo.openObservation}
                    >
                      {'Go to observation'}
                    </Button>
                  </div>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
