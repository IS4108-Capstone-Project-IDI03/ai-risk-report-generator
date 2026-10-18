// Loads the PDF viewer's code (CB-02), apart from the chat, so pdf.js isn't in the chat's
// first download. Used by CitationPanel (lazy) and screens/KnowledgeAssistant.tsx (preload).

/** Returns the PdfViewer module, downloading it on first call. */
export const loadPdfViewer = () => import('./PdfViewer')

/** Starts downloading the PDF viewer's code in the background. */
// Without it, a PDF tab clicked straight after the page loads waited ~300 ms for the code.
export const preloadPdfViewer = () => void loadPdfViewer()
