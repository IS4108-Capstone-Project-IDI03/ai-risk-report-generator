// A manually entered clause's screenshots (IN-18), shown where a PDF passage's region
// of the page goes (CitedRegion): above the passage text, sized as regions are. A
// manual document has no file to cut a region from; the screenshot is the original.
// Used by the knowledge base's Passages detail and the chat's Passage tab.
import './sources.css'

/** The screenshots, or nothing when there are none. `alt` names them, e.g. "Table". */
export function CitedImage({ urls, alt }: { urls: string[]; alt: string }) {
  if (urls.length === 0) return null
  return (
    <div className="src-regions">
      {urls.map((url, i) => (
        <img
          key={url}
          className="src-region"
          src={url}
          alt={urls.length === 1 ? alt : `${alt} ${i + 1}`}
          loading="lazy"
        />
      ))}
    </div>
  )
}
