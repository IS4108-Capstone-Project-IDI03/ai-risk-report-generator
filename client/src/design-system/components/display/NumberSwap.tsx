// A number that crossfades when it changes (GN-13 motion 3: out 100 ms, in 120 ms). Used by
// SegmentBar's "N of 11" and StepCard's "3 of 8". Calls useSwap.
import { useSwap } from './useSwap'
import './steps.css'

/** Returns the number, with the old one fading out over it for 100 ms after a change. */
export function NumberSwap({ value }: { value: number }) {
  const { was, moved, turn } = useSwap(value, 100)
  return (
    <span className="ds-numswap">
      {was !== null && (
        <span key={`was-${turn}`} data-out="" aria-hidden="true">
          {was}
        </span>
      )}
      <span key={`now-${turn}`} data-in={moved ? '' : undefined}>
        {value}
      </span>
    </span>
  )
}
