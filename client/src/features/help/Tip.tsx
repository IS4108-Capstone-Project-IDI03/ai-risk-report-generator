// F-13: <Tip id="review.findings" /> is the (?) a screen places beside a heading or a button. It
// looks the tip up in tips.ts, hides itself for a role the tip is not for, draws the words with
// MarshBot's text rules, and adds "Show me" when the tip names a walkthrough this role can play.
// Called by every screen with a tip. Calls HelpTip, RichText, the walkthrough engine.
import type { ReactNode } from 'react'
import { HelpTip } from '../../design-system'
import { canPlay, play, useWalkthroughs } from '../walkthrough/engine'
import { RichText } from './RichText'
import { TIPS, type TipDef, type TipId } from './tips'

/** Returns the tip's (?), or nothing when the signed-in role is not one of the tip's roles. */
export function Tip({
  id,
  align,
  children,
}: {
  id: TipId
  align?: 'left' | 'right'
  // The words as markup, for the 7 tips that exist today (their `text` is not in tips.ts).
  children?: ReactNode
}) {
  const role = useWalkthroughs((s) => s.role)
  const tip: TipDef = TIPS[id]
  const body = children ?? (tip.text ? <RichText text={tip.text} /> : null)
  if (!body || !tip.roles.includes(role)) return null
  const target = tip.walkthrough
  // Show me needs the engine's say-so: that walkthrough must exist for this role.
  const showMe = target && canPlay(target) ? () => play([target]) : undefined
  return (
    <HelpTip label={tip.label} align={align} onShowMe={showMe}>
      {body}
    </HelpTip>
  )
}
