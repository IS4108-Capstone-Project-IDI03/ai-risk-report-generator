// KaTeX and its stylesheet (KB-02 AC5), loaded on first use by PassageBody through
// loadMathRenderer, so neither is in the chat's or the review workspace's first download.
import katex from 'katex'
import 'katex/dist/katex.min.css'

/** Returns the formula as KaTeX HTML, or null when it is not valid LaTeX. */
export function renderMath(latex: string, display: boolean): string | null {
  try {
    // trust: false (the default) keeps \href and \includegraphics out of passage text.
    return katex.renderToString(latex, { displayMode: display, throwOnError: true })
  } catch {
    return null
  }
}
