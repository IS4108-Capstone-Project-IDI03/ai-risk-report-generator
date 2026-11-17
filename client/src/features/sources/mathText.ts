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

// Words a formula labels itself with (\text{Switch Room: }), which are not prose.
const TEXT_IN_MATH = /\\(?:text\w*|mathrm|mbox|operatorname)\s*\{[^{}]*\}/g

const isFormula = (line: string) =>
  COMMAND.test(line) && !PROSE.test(line.replace(TEXT_IN_MATH, ' '))

// Braces opened and not yet closed in a line; escaped ones (\{) don't count.
const openBraces = (line: string) =>
  (line.match(/(?<!\\)\{/g)?.length ?? 0) - (line.match(/(?<!\\)\}/g)?.length ?? 0)
// How many more lines a formula left open (\frac{…} on one line, {…} on the next) may take.
const MAX_JOINED = 3

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

/** One run per line of text[from, to); a line break belongs to the run before it. A formula the
 * text breaks over lines is one run: a line takes the next while it leaves a brace open, or
 * while the next starts with one (\frac{…} on one line, its {…} on the next). */
function lineRuns(text: string, from: number, to: number): Run[] {
  const lines = text.slice(from, to).split('\n')
  const runs: Run[] = []
  let start = from
  const continues = (block: string, next: string | undefined) =>
    next !== undefined && COMMAND.test(block) && (openBraces(block) > 0 || /^\s*\{/.test(next))
  for (let i = 0; i < lines.length; i++) {
    let block = lines[i]
    for (let n = 0; n < MAX_JOINED && continues(block, lines[i + 1]); n++) {
      block += '\n' + lines[++i]
    }
    const end = Math.min(start + block.length + 1, to)
    runs.push(isFormula(block) ? { start, end, latex: block } : { start, end })
    start = end
  }
  return runs.filter((run) => run.end > run.start)
}
