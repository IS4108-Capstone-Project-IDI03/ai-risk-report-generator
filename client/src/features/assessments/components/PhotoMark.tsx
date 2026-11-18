// The area of a photo the engineer marked as what matters (CP-10), drawn over
// the photo wherever it is shown: a box on a layer that covers exactly the
// image as shown, so the box's percentages are fractions of the photo. The
// photo itself is never changed. Used by ZoomablePhoto.tsx and PhotoGrid.tsx.
import type { PhotoRegion } from '../api'

// The marked box, on a layer from useImageLayer (markGeometry.ts). While marking, the rest of the
// photo is dimmed so the marked area stands out.
export function MarkBox({ region, marking = false }: { region: PhotoRegion; marking?: boolean }) {
  return (
    <div
      data-testid="photo-mark"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
        boxSizing: 'border-box',
        // White with a dark edge, so it shows on light and dark photos alike.
        border: '2px solid var(--text-inverse)',
        boxShadow: marking
          ? '0 0 0 1px var(--scrim), 0 0 0 9999px var(--scrim)'
          : '0 0 0 1px var(--scrim), inset 0 0 0 1px var(--scrim)',
        borderRadius: '2px',
        pointerEvents: 'none',
      }}
    />
  )
}
