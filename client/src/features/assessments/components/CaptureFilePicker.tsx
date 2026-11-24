// A file picker drawn as a design-system pill (CP-24): the label is the button and its hidden
// file input (ds-choice) is the real control. `tone` is a grey pill, or the quiet navy link
// ("Upload audio files"). Used by the Voice, Photo and Scan tabs of New Observation.
import type { ChangeEvent } from 'react'
import { Icon } from '../../../design-system'
import '../capture.css'

/** Returns the pill-styled file picker: the label as the button, the hidden input as the control. */
export function CaptureFilePicker({
  icon,
  label,
  accept,
  onChange,
  disabled,
  capture,
  multiple,
  tone = 'pill',
  className,
}: {
  icon: string
  label: string
  accept: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
  // Opens the camera, not the library (a phone; a desktop ignores it).
  capture?: 'environment'
  multiple?: boolean
  tone?: 'pill' | 'link'
  className?: string
}) {
  return (
    <label
      className={`ds-choice cap-pick cap-pick--${tone} ${className ?? ''}`.trim()}
      aria-disabled={disabled || undefined}
    >
      <Icon name={icon} size={tone === 'link' ? 16 : 18} />
      {label}
      <input
        type="file"
        accept={accept}
        capture={capture}
        multiple={multiple}
        onChange={onChange}
        disabled={disabled}
      />
    </label>
  )
}
