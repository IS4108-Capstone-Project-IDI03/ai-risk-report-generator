// The choice for a photo with faces in it (CB-08 AC3): blur them (the default) or send as is.
// Drawn under each such photo by components/PhotoAttach.tsx. Calls `onChange`; it knows no API.
import { SegmentedControl } from '../../../design-system'

type Props = { faces: number; value: 'blur' | 'asis'; onChange: (value: 'blur' | 'asis') => void }

/** "2 faces found" and a two-way choice. */
export function FaceChoice({ faces, value, onChange }: Props) {
  return (
    <div className="face-choice">
      <span>{faces === 1 ? '1 face found' : `${faces} faces found`}</span>
      <SegmentedControl
        ariaLabel="Faces in this photo"
        value={value}
        onChange={onChange}
        options={[
          { value: 'blur', label: 'Blur faces' },
          { value: 'asis', label: 'Send as is' },
        ]}
      />
    </div>
  )
}
