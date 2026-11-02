// A labelled list of what one capture mode has added, waiting for Save observation (CP-02).
// Called by CaptureVoicePanel, CapturePhotoPanel and CaptureScanPanel.
import { useId } from 'react'
import type { ReactNode } from 'react'

// What one mode adds to the observation, waiting for Save observation; the
// switcher above already counts them.
export function DraftList({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId()
  return (
    <section
      aria-labelledby={labelId}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <span
        id={labelId}
        style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}
      >
        {label}
      </span>
      {children}
    </section>
  )
}
