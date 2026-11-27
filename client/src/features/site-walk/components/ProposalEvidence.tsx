// The cards under a proposed observation's note (CP-22 round 6, v2 in CP-24): the recordings it
// was heard in, then its photos and handwritten pages, each a card only when it has something, as
// on the saved observation's page. A clip is the walk's recording, played from where the
// observation starts. Used by screens/ProposalPage.tsx. Calls RecordCard, RecordingRow, PhotoGrid.
import { PhotoGrid, type Tile } from '../../assessments/components/PhotoGrid'
import { RecordCard } from '../../assessments/components/RecordCard'
import { usePhone } from '../usePhone'
import type { SiteWalk } from '../api'
import { RecordingRow, type RecordingRowItem } from './RecordingRow'

type Voice = NonNullable<SiteWalk['media']>[number]
type Opened = Tile & { url: string }

// Create all transcribes a failed clip again on the observation.
const NOT_YET = 'Not transcribed yet. It is transcribed again when you create all.'

// A voice clip added by hand, as the row reads it.
function voiceItem(v: Voice): RecordingRowItem {
  const status =
    v.transcription === 'transcribed'
      ? 'done'
      : v.transcription === 'failed'
        ? 'failed'
        : 'transcribing'
  return { status, transcript: v.transcript, audioUrl: v.url, durationSec: null }
}

/** Returns the Recordings, Photos and Handwritten Pages cards (none for an empty one). */
export function ProposalEvidence({
  clip,
  clipLength,
  voices,
  photos,
  pages,
  onOpen,
}: {
  // The walk's recording from where this observation starts to where it ends, or null.
  clip: string | null
  clipLength: number | null
  voices: Voice[]
  photos: Tile[]
  pages: Tile[]
  onOpen: (tile: Opened) => void
}) {
  const phone = usePhone()
  return (
    <>
      {(clip || voices.length > 0) && (
        <RecordCard title="Recordings">
          <ul className="sw-list cpp-list">
            {clip && (
              <RecordingRow
                item={{ status: 'done', transcript: null, audioUrl: clip, durationSec: clipLength }}
                phone={phone}
                label="Site walk recording"
              />
            )}
            {voices.map((v, i) => (
              <RecordingRow
                key={v.id}
                item={voiceItem(v)}
                phone={phone}
                label={`Voice ${i + 1}`}
                error={v.transcription === 'failed' ? NOT_YET : null}
              />
            ))}
          </ul>
        </RecordCard>
      )}
      {photos.length > 0 && (
        <RecordCard title={'Photos · ' + photos.length} label="Photos">
          <PhotoGrid label="Photos of this observation" tiles={photos} onOpen={onOpen} />
        </RecordCard>
      )}
      {/* Pages are read once Create all makes the observation, so tiles only. */}
      {pages.length > 0 && (
        <RecordCard title={'Handwritten Pages · ' + pages.length} label="Handwritten Pages">
          <PhotoGrid label="Handwritten pages of this observation" tiles={pages} onOpen={onOpen} />
        </RecordCard>
      )}
    </>
  )
}
