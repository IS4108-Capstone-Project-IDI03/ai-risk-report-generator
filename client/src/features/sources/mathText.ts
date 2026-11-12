// Where a passage's text holds a formula (KB-02 AC5). Ingestion's formula reader writes LaTeX
// in the passage text, undelimited (Claude, Gemini) or inside $$ … $$ (GLM). Used by PassageBody.

/** A run of the text: `latex` is set when the run may be a formula, `start`/`end` index `text`. */
export type Run = { start: number; end: number; latex?: string }

// A LaTeX command such as \frac or \times.
const COMMAND = /\\[A-Za-z]+/
// Two words in a row that are not commands ("is the"): prose, which the formula reader keeps
// as plain text, and which KaTeX would run together in italics.
const PROSE = /(?:^|[^\\A-Za-z])[A-Za-z]{2,}\s+[A-Za-z]{2,}(?![A-Za-z])/

// A formula between $$ … $$ or \[ … \], which may span lines.
const DELIMITED = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g

const isFormula = (line: string) => COMMAND.test(line) && !PROSE.test(line)

/** Splits the text into runs: each delimited formula, then each line of the rest. A run that
 * may be a formula carries its LaTeX; a delimited one without its delimiters. */
export function runsOf(text: string): Run[] {
  const runs: Run[] = []
  let at = 0
  for (const match of text.matchAll(DELIMITED)) {
    runs.push(...lineRuns(text, at, match.index))
    at = match.index + match[0].length
    runs.push({ start: match.index, end: at, latex: (match[1] ?? match[2]).trim() })
  }
  return [...runs, ...lineRuns(text, at, text.length)]
}

/** One run per line of text[from, to); a line break belongs to the run before it. */
function lineRuns(text: string, from: number, to: number): Run[] {
  const runs: Run[] = []
  let start = from
  for (const line of text.slice(from, to).split('\n')) {
    const end = Math.min(start + line.length + 1, to)
    runs.push(isFormula(line) ? { start, end, latex: line } : { start, end })
    start = end
  }
  return runs.filter((run) => run.end > run.start)
}
