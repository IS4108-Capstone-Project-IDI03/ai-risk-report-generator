// Splits MarshBot's fixed words into paragraphs, bullets and bold runs (F-12 copy format).
// Called by TypedText. Calls nothing.

export type Block = { bullet: boolean; runs: { text: string; bold: boolean }[] }

/** Returns the message as paragraphs and bullets: "\n\n" starts a paragraph, "- " a bullet, **bold** key words. */
export function blocksOf(say: string): Block[] {
  const blocks: Block[] = []
  for (const paragraph of say.split(/\n\s*\n/)) {
    let words: string[] = []
    const flush = () => {
      if (words.length) blocks.push({ bullet: false, runs: runsOf(words.join(' ')) })
      words = []
    }
    for (const line of paragraph
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)) {
      if (line.startsWith('- ')) {
        flush()
        blocks.push({ bullet: true, runs: runsOf(line.slice(2)) })
      } else words.push(line)
    }
    flush()
  }
  return blocks
}

// "**Inbox** shows" as runs; an unpaired ** stays as plain words.
function runsOf(text: string) {
  const parts = text.split('**')
  const unclosed = parts.length % 2 === 0
  return parts
    .map((part, i) => ({ text: part, bold: i % 2 === 1 && !(unclosed && i === parts.length - 1) }))
    .filter((run) => run.text)
}

/** Returns the plain words of a message, as a screen reader hears them. */
export const plainOf = (say: string) =>
  blocksOf(say)
    .map((b) => b.runs.map((r) => r.text).join(''))
    .join(' ')
