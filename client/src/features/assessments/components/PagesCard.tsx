// An observation's handwritten pages (CP-19, CP-20, CP-24): a card of page rows drawn beside the
// recording rows. Rendered by screens/ObservationPage.tsx. Calls RecordCard, PageEntry.
import type { ViewedPhoto } from './PhotoReferences'
import { PageEntry, type PageView } from './PageEntry'
import { RecordCard } from './RecordCard'

/** Returns the Handwritten pages card; the round mark on a row opens its page through `onView`. */
export function PagesCard({
  pages,
  onView,
}: {
  pages: PageView[]
  onView: (photo: Pick<ViewedPhoto, 'name' | 'url'>) => void
}) {
  return (
    <RecordCard title={'Handwritten Pages · ' + pages.length} label="Handwritten Pages">
      <ul className="sw-list cpp-list">
        {pages.map((p) => (
          <PageEntry key={p.id} page={p} onView={() => onView({ name: p.name, url: p.url })} />
        ))}
      </ul>
    </RecordCard>
  )
}
