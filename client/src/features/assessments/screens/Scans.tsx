import { useState } from 'react'
import { Button, EmptyState, IconRegistry } from '../../../design-system'
import { PageEntry } from '../components/PageEntry'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

// The assessment's handwritten pages (CP-19), beside the photo collection:
// every page saved with its observations, except a deleted observation's,
// each with its transcript, the original to check it against, and the
// observation it belongs to. Pages are not site photos, so they have their
// own view rather than joining the Photos one.
export function Scans({ v }: { v: AssessmentWorkflow }) {
  const scans = v.scanCollection
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  return (
    <div
      style={{
        padding: '24px clamp(16px,2vw,28px) 40px',
        animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
      }}
    >
      {/* Opened from the Observations tab's Scans box, so it leads back there. */}
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
          fontSize: '19px',
          lineHeight: '28px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          marginBottom: '6px',
        }}
      >
        {'Handwritten pages'}
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
          'Every page of handwritten notes saved with this assessment’s observations, with its transcript. Pages of a deleted observation are left out until it is restored.'
        }
      </p>
      {scans.length === 0 ? (
        <div
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px',
          }}
        >
          <EmptyState
            icon={IconRegistry.evidence.handwriting}
            title="No handwritten pages yet"
            description="Pages appear here once they are saved with an observation in Scan mode."
          />
        </div>
      ) : (
        <ul
          aria-label="Handwritten pages"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
            alignItems: 'start',
            gap: '16px',
          }}
        >
          {scans.map((scan) => (
            <li
              key={scan.key}
              style={{
                padding: '4px 16px 14px',
                background: 'var(--surface-card)',
                border: '1px solid var(--border-default)',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-sm)',
                minWidth: 0,
              }}
            >
              <PageEntry
                page={scan.page}
                onView={() =>
                  setViewing({ name: scan.page.name, url: scan.page.url, context: scan.where })
                }
              />
              <div
                style={{
                  marginTop: '12px',
                  paddingTop: '10px',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' }}>
                  {scan.where}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{scan.cat}</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {scan.time}
                </span>
                <div style={{ marginTop: '6px' }}>
                  <Button variant="ghost" size="sm" iconLeft="link" onClick={scan.openObservation}>
                    {'Go to observation'}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
