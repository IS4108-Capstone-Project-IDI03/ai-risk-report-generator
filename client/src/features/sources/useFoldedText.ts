// Folds a table's or formula's text behind its drawn region (KB-02); used with CitedRegion and
// PassageBody by the Passages view, the chat's Passage tab and the review workspace's source panel.
import { useState } from 'react'
import type { Passage } from '../chat/api'

/** Whether a passage's text folds behind its region (KB-02): a table's or formula's once the region
 * is drawn, as the crop then shows what the text repeats; a picture's description never does.
 * Pass `onDrawn` to CitedRegion and `folded` to PassageBody. Keyed by the region's content, so
 * another citation's region starts unfolded. */
export function useFoldedText(region: Passage['region']) {
  const key = region ? JSON.stringify(region) : null
  const [drawn, setDrawn] = useState<string | null>(null)
  return {
    folded: key !== null && region?.kind !== 'picture' && drawn === key,
    onDrawn: () => setDrawn(key),
  }
}
