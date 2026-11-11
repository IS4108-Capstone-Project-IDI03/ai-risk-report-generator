// MarshBot's face, Robot A "Visor" (AS-06 board 16): one inline SVG, four moods that crossfade
// over 180 ms with the antenna light, and an idle blink every 4 to 7 s. Used by StageRail and
// PhoneStageBar; the chatbot's logo (features/chat/marshbot.svg) is the idle face on navy.
import { useEffect, useState } from 'react'
import type { Mood } from '../types'

// The antenna light and chest button take the mood's colour (Moods.dc.html).
const LIGHT: Record<Mood, string> = {
  idle: '#8fd3ff',
  concerned: '#f6c75e',
  pleased: '#5cc48a',
  thinking: '#8fd3ff',
}
const EYE = '#8fd3ff'

// Each mood's eyes and mouth, drawn over the same visor.
function Features({ mood }: { mood: Mood }) {
  if (mood === 'concerned')
    return (
      <>
        <path d="M41 49 l11 -3" stroke={EYE} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M79 49 l-11 -3" stroke={EYE} strokeWidth="2.5" strokeLinecap="round" />
        <rect x="43" y="52" width="9" height="11" rx="4.5" fill={EYE} />
        <rect x="68" y="52" width="9" height="11" rx="4.5" fill={EYE} />
        <path d="M55 67 h10" stroke={EYE} strokeWidth="2.5" strokeLinecap="round" />
      </>
    )
  if (mood === 'pleased')
    return (
      <g fill="none" stroke={EYE} strokeLinecap="round">
        <path d="M42 59 q5.5 -9 11 0" strokeWidth="4" />
        <path d="M67 59 q5.5 -9 11 0" strokeWidth="4" />
        <path d="M53 64 q7 5 14 0" strokeWidth="2.5" />
      </g>
    )
  if (mood === 'thinking')
    return (
      <>
        <rect x="47" y="45" width="9" height="13" rx="4.5" fill={EYE} />
        <rect x="72" y="45" width="9" height="13" rx="4.5" fill={EYE} />
        <circle cx="52" cy="66" r="2" fill={EYE} />
        <circle cx="60" cy="66" r="2" fill={EYE} opacity=".7" />
        <circle cx="68" cy="66" r="2" fill={EYE} opacity=".45" />
      </>
    )
  return (
    <g className="mb-face-eyes">
      <rect x="43" y="48" width="9" height="15" rx="4.5" fill={EYE} />
      <rect x="68" y="48" width="9" height="15" rx="4.5" fill={EYE} />
    </g>
  )
}

const MOODS: Mood[] = ['idle', 'concerned', 'pleased', 'thinking']
const SAID: Record<Mood, string> = {
  idle: 'MarshBot',
  concerned: 'MarshBot, concerned',
  pleased: 'MarshBot, pleased',
  thinking: 'MarshBot, thinking',
}

/** Returns the Visor robot in `mood`; `decorative` hides it from screen readers. */
export function MarshBotFace({ mood, decorative = false }: { mood: Mood; decorative?: boolean }) {
  // Blinks only while idle, at a random 4 to 7 s, so it never looks mechanical.
  const [blink, setBlink] = useState(false)
  useEffect(() => {
    if (mood !== 'idle' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      timer = setTimeout(
        () => {
          setBlink(true)
          timer = setTimeout(() => {
            setBlink(false)
            next()
          }, 140)
        },
        4000 + Math.random() * 3000,
      )
    }
    next()
    return () => clearTimeout(timer)
  }, [mood])
  return (
    <svg
      className="mb-face-svg"
      viewBox="0 0 120 120"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : SAID[mood]}
      data-blink={blink || undefined}
    >
      <ellipse cx="60" cy="113" rx="28" ry="4" fill="#000f47" opacity=".08" />
      <line
        x1="60"
        y1="13"
        x2="60"
        y2="26"
        stroke="#0b2a78"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle
        className="mb-face-light"
        cx="60"
        cy="10"
        r="6"
        fill={LIGHT[mood]}
        opacity={mood === 'thinking' ? 0.5 : 1}
      />
      <rect x="12" y="47" width="12" height="22" rx="6" fill="#0b2a78" />
      <rect x="96" y="47" width="12" height="22" rx="6" fill="#0b2a78" />
      <rect x="20" y="24" width="80" height="64" rx="24" fill="#0b2a78" />
      <rect x="28" y="29" width="34" height="6" rx="3" fill="#fff" opacity=".14" />
      <rect x="30" y="39" width="60" height="34" rx="17" fill="#06123f" />
      {/* Every mood stays drawn; only the current one shows, so a change crossfades. */}
      {MOODS.map((m) => (
        <g key={m} className="mb-face-mood" data-on={m === mood || undefined}>
          <Features mood={m} />
        </g>
      ))}
      <rect x="38" y="91" width="44" height="18" rx="9" fill="#000f47" />
      <circle className="mb-face-light" cx="60" cy="100" r="3.5" fill={LIGHT[mood]} />
    </svg>
  )
}
