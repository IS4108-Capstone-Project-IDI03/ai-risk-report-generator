// "I need another visit" (AS-06 canvas C7, C8): the design system's calendar floats above the
// tray (a centred sheet on a phone), from today on; picking a day swaps it for a short confirm of
// what will change. Nothing is sent until Confirm. Used by ReplyTray.tsx.
import { useState } from 'react'
import { Button, Popover } from '../../../../design-system'
import { Calendar } from '../../../../design-system/components/forms/DatePicker'
import { shortDay, today, visitDay } from '../../format'
import type { Reply } from '../../types'
import { ReplyButton } from './ReplyButton'

/** Returns the reply that picks a day, then confirms it, then sends `onSend(day)`. */
export function DateReply({
  reply,
  disabled,
  surveyEnd,
  onSend,
}: {
  reply: Reply
  disabled: boolean
  // The survey's last day now, shown struck through beside the picked one.
  surveyEnd: string | null
  onSend: (day: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  // Closing for any reason (Escape, a click outside, Cancel) starts again from the calendar.
  const close = () => {
    setOpen(false)
    setDay(null)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      trigger={<ReplyButton reply={reply} disabled={disabled} onClick={() => setOpen((o) => !o)} />}
      ariaLabel={day ? 'Confirm the New Survey End' : 'Day of Your Next Visit'}
      align="right"
      sheetCentred
      surfaceClassName="mbt-pop"
    >
      {day ? (
        <div className="mbt-confirm">
          <b>{visitDay(day)}</b>
          {surveyEnd && (
            <p>
              Survey End <s>{shortDay(surveyEnd)}</s>
              {/* A text arrow: the icon set loads from a CDN and an arrow that fails says nothing. */}
              <span aria-hidden="true">→</span>
              <span className="mbt-sr">to</span>
              <b>{shortDay(day)}</b>
            </p>
          )}
          <div className="mbt-confirm-actions">
            <Button variant="tonal" pill onClick={close} style={{ color: 'var(--marsh-navy)' }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pill
              onClick={() => {
                close()
                onSend(day)
              }}
            >
              Confirm
            </Button>
          </div>
        </div>
      ) : (
        <Calendar value="" min={today()} focusDay onPick={setDay} />
      )}
    </Popover>
  )
}
