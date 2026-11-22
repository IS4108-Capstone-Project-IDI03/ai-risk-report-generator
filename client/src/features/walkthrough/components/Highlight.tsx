// The highlight (F-12, NEW pattern; canvas WalkthroughSpotlight): the dimming over the screen with
// one rounded cut-out round the target (its box plus 6 px, radius 10, --scrim). Between screens a
// "plug" fades over the cut-out (120 ms) and away again (180 ms); on the same screen the cut-out
// glides to the next target (320 ms). The dimming blocks presses; the cut-out lets them through.
// Called by WalkthroughHost. Calls nothing.
import { useEffect, useRef, useState } from 'react'

export type Box = { x: number; y: number; w: number; h: number }

const PAD = 6
const RADIUS = 10
const GLIDE_MS = 320

// The rounded rectangle round a box, grown by PAD.
function roundRect({ x, y, w, h }: Box) {
  const [l, t, W, H] = [x - PAD, y - PAD, w + PAD * 2, h + PAD * 2]
  const r = Math.min(RADIUS, W / 2, H / 2)
  return `M${l + r} ${t}H${l + W - r}A${r} ${r} 0 0 1 ${l + W} ${t + r}V${t + H - r}A${r} ${r} 0 0 1 ${l + W - r} ${t + H}H${l + r}A${r} ${r} 0 0 1 ${l} ${t + H - r}V${t + r}A${r} ${r} 0 0 1 ${l + r} ${t}Z`
}

// --ease-in-out from tokens/motion.css, cubic-bezier(0.77, 0, 0.175, 1), as a function of time.
function easeInOut(t: number) {
  const bezier = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (bezier(0.77, 0.175, mid) < t) lo = mid
    else hi = mid
  }
  return bezier(0, 1, (lo + hi) / 2)
}

/** Returns the box the cut-out shows: it glides to a new target (`glideKey` changed), else follows at once. */
function useGlide(box: Box | null, glideKey: string, calm: boolean): Box | null {
  const [shown, setShown] = useState(box)
  const from = useRef(box)
  const key = useRef(glideKey)
  useEffect(() => {
    const start = from.current
    const gliding = key.current !== glideKey && start && box && !calm
    key.current = glideKey
    if (!gliding) {
      from.current = box
      setShown(box)
      return
    }
    const began = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const t = easeInOut(Math.min(1, (now - began) / GLIDE_MS))
      const mix = (a: number, b: number) => a + (b - a) * t
      const next = {
        x: mix(start.x, box.x),
        y: mix(start.y, box.y),
        w: mix(start.w, box.w),
        h: mix(start.h, box.h),
      }
      from.current = next
      setShown(next)
      if (t < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [box, glideKey, calm])
  return shown
}

/** Returns the dimming, the cut-out round `box` (or the plug over its last place), and the "Your turn" ring. */
export function Highlight({
  box,
  holes,
  glideKey,
  ring,
  passThrough,
  calm,
}: {
  box: Box | null
  // Several cut-outs in place of the one round `box` (a step that lights its targets one by one).
  holes?: Box[] | null
  glideKey: string
  ring: 'off' | 'on' | 'done'
  // A hands-on step: presses inside the cut-out reach the control.
  passThrough: boolean
  calm: boolean
}) {
  const shown = useGlide(box, glideKey, calm)
  // Where the cut-out last was, so the plug can cover it while the next screen settles.
  const [lastBox, setLastBox] = useState(shown)
  if (shown && shown !== lastBox) setLastBox(shown)
  // The window's size, kept current: a card step has no box to re-measure, so without this a
  // rotated phone or a resized window would leave the dimming at its old size.
  const [[width, height], setWin] = useState([window.innerWidth, window.innerHeight])
  useEffect(() => {
    const onResize = () => setWin([window.innerWidth, window.innerHeight])
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const hole = lastBox ? roundRect(lastBox) : ''
  // Separate cut-outs are drawn where they are (no glide); between screens the one box takes over.
  const cut = holes && box ? holes.map(roundRect).join('') : hole
  return (
    <>
      <svg className="wt-dim" aria-hidden="true" viewBox={`0 0 ${width} ${height}`}>
        <path d={`M0 0H${width}V${height}H0Z${cut}`} fillRule="evenodd" />
        {lastBox && <path className="wt-plug" d={hole} data-on={!box || undefined} />}
      </svg>
      {/* Tell steps: the whole page is blocked, the cut-out too. */}
      {!passThrough && <div className="wt-block" />}
      {lastBox && box && ring !== 'off' && (
        <span
          className="wt-ring"
          data-done={ring === 'done' || undefined}
          style={
            {
              left: lastBox.x - PAD,
              top: lastBox.y - PAD,
              width: lastBox.w + PAD * 2,
              height: lastBox.h + PAD * 2,
              '--sx': (lastBox.w + PAD * 2 + 12) / (lastBox.w + PAD * 2),
              '--sy': (lastBox.h + PAD * 2 + 12) / (lastBox.h + PAD * 2),
            } as React.CSSProperties
          }
        />
      )}
    </>
  )
}
