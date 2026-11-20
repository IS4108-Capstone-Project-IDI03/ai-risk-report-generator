// Folds a passage's text behind its drawn region or screenshot (KB-02, IN-18); used with
// CitedRegion, CitedImage and PassageBody by the Passages view, the chat's Passage tab and the
// review workspace's source panel.
import { useState } from 'react'
import type { Passage } from '../chat/api'

/** Whether a passage's text folds behind the original shown above it (KB-02, IN-18): a table's,
 * formula's or picture's once its region is drawn, or a manual clause's when it has screenshots,
 * as the crop then shows what the text repeats or describes. Pass `onDrawn` to CitedRegion, and
 * `folded` to PassageBody. Keyed by the region's content, so another citation's region
 * starts unfolded. */
export function useFoldedText(region: Passage['region'], hasImages = false) {
  const key = region ? JSON.stringify(region) : null
  const [drawn, setDrawn] = useState<string | null>(null)
  return {
    folded: hasImages || (key !== null && drawn === key),
    onDrawn: () => setDrawn(key),
  }
}
