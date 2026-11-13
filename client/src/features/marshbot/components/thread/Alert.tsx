// A message from MarshBot that stands out (AS-06 round 8): the report is overdue. It is a speech
// bubble like the others, in the amber warning tint with a warning icon. Called by library.tsx's
// Alert and TurnBody's fallback. Calls Bubble.tsx.
import { useContext } from 'react'
import { Icon } from '../../../../design-system'
import { SlotContext } from '../../context'
import { Bubble, Runs } from './Bubble'

/** Returns the stand-out message, with "Important" for a screen reader. */
export function Alert({ text }: { text: string }) {
  const slot = useContext(SlotContext)
  return (
    <Bubble tone="alert" tail={slot.tail} index={slot.index}>
      <p className="mbt-alert">
        <Icon name="triangle-alert" size={16} />
        <span>
          <span className="mbt-sr">Important: </span>
          <Runs text={text} />
        </span>
      </p>
    </Bubble>
  )
}
