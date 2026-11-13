// How react-pdf (Mozilla's pdf.js) opens a knowledge-base file, shared by the PDF tab
// (PdfViewer.tsx) and the source region (features/sources/SourceRegion.tsx). Both are loaded
// lazily, so pdf.js stays out of the first download; each imports this before drawing.
import { pdfjs } from 'react-pdf'

// react-pdf's docs: set the worker before <Document> renders, beside the react-pdf import. Vite
// turns the new URL(...) into a hashed file served next to the page. The legacy worker, to match
// the legacy pdf.js build vite.config.ts aliases in (older browsers).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// pdf.js asks for byte ranges only as pages need them (pdfSource.ts fetches them), instead of
// fetching pages nobody looks at. A module constant, so react-pdf doesn't reload the document
// on every render.
//
// wasmUrl: where pdf.js fetches its JPEG 2000 and JBIG2 image decoders and its colour module, by
// file name. Without it, a page that is one big image (all of NFPA 13 2022) is drawn blank. The
// dev server serves node_modules; the build copies the folder to /pdfjs-wasm/ (vite.config.ts,
// pdfjsWasm), which must match the path here.
export const PDF_OPTIONS = {
  disableAutoFetch: true,
  wasmUrl: import.meta.env.DEV ? '/node_modules/pdfjs-dist/wasm/' : '/pdfjs-wasm/',
}
