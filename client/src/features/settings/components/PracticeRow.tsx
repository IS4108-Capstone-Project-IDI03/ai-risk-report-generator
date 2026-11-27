// The practice assessment's row in Settings > Walkthroughs (F-12): a tile, its name and line, and
// Open, Reset and Remove. Reset and Remove ask first. When it is gone the line says it was removed
// with a button to set it up again. Called by WalkthroughsSection. Calls the engine and ConfirmDialog.
import { useState } from 'react'
import { Button, IconAction, IconTile } from '../../../design-system'
import { Tip } from '../../help/Tip'
import {
  openPractice,
  removePractice,
  setUpPractice,
  useWalkthroughs,
} from '../../walkthrough/engine'
import { attempt } from './attempt'
import { ConfirmDialog } from './ConfirmDialog'

const QUIET = { color: 'var(--graphite-600)' }

/** Returns the practice row, drawn from the signed-in person's walkthrough record. */
export function PracticeRow() {
  const practice = useWalkthroughs((s) => s.record.practice)
  const [asking, setAsking] = useState<'reset' | 'remove' | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const setUpAgain = async () => {
    setSettingUp(true)
    await attempt(
      setUpPractice,
      'Practice assessment is ready',
      "Couldn't set up the practice assessment",
    )
    setSettingUp(false)
  }
  return (
    <section className="wts-practice" aria-label="Practice assessment">
      <IconTile icon="clipboard-list" />
      <div className="wts-pname">
        <span className="wts-ptitle">
          Practice assessment <Tip id="settings.practice" />
        </span>
        <span>
          {practice
            ? "Only you can see it, and it isn't counted anywhere."
            : "You've removed it, but you can set it up again at any time."}
        </span>
      </div>
      {practice ? (
        <span className="wts-pactions">
          <IconAction
            icon="arrow-up-right"
            label="Open practice assessment"
            tooltip="Open"
            style={QUIET}
            onClick={openPractice}
          />
          <IconAction
            icon="rotate-ccw"
            label="Reset practice assessment"
            tooltip="Reset"
            style={QUIET}
            onClick={() => setAsking('reset')}
          />
          <IconAction
            icon="trash-2"
            label="Remove practice assessment"
            tooltip="Remove"
            style={{ color: 'var(--red-600)' }}
            onClick={() => setAsking('remove')}
          />
        </span>
      ) : (
        <Button variant="pill" pill loading={settingUp} onClick={setUpAgain}>
          Set it up again
        </Button>
      )}
      {asking === 'reset' && (
        <ConfirmDialog
          title="Reset the practice assessment?"
          body="Your practice assessment is replaced with a fresh one, so you can practise from the start. None of your real assessments are touched."
          confirm="Reset"
          run={setUpPractice}
          done="Practice assessment reset"
          failed="Couldn't reset the practice assessment"
          onClose={() => setAsking(null)}
        />
      )}
      {asking === 'remove' && (
        <ConfirmDialog
          title="Remove the practice assessment?"
          body="It disappears from your Assessments list, and none of your real assessments are touched. You can set it up again here at any time."
          confirm="Remove"
          danger
          run={removePractice}
          done="Practice assessment removed"
          failed="Couldn't remove the practice assessment"
          onClose={() => setAsking(null)}
        />
      )}
    </section>
  )
}
