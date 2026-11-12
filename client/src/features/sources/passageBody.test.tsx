// Tests for a cited passage's text (KB-02 AC5): formulas the OCR read as LaTeX are shown as
// math when the LaTeX is valid, and as written when it is not; the quoted words stay marked.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { PassageBody } from './PassageBody'

afterEach(cleanup)

const body = () => screen.getByLabelText('Passage text')
// The text shown as written: KaTeX keeps the LaTeX source in hidden MathML for screen readers.
const plainText = () => {
  const copy = body().cloneNode(true) as HTMLElement
  copy.querySelectorAll('.katex').forEach((math) => math.remove())
  return copy.textContent
}

describe('PassageBody', () => {
  it('shows a valid formula as math', async () => {
    render(<PassageBody text={'Concentration:\nC = \\frac{100}{2}'} quote="" />)
    await waitFor(() => expect(body().querySelector('.katex')).not.toBeNull())
    expect(plainText()).toBe('Concentration:\n')
  })

  it('shows LaTeX that is not valid as written, with no error', async () => {
    render(<PassageBody text={'x = \\sqrt{2}\nW = \\frac{V}{S'} quote="" />)
    // The first line renders, so KaTeX has loaded when the second is checked.
    await waitFor(() => expect(body().querySelectorAll('.katex')).toHaveLength(1))
    expect(plainText()).toBe('W = \\frac{V}{S')
  })

  it('shows a line of prose that mentions a symbol as written', async () => {
    // Valid LaTeX, but as math its words would run together in italics.
    render(<PassageBody text={'x = \\sqrt{2}\nwhere \\alpha is the angle of the pipe'} quote="" />)
    await waitFor(() => expect(body().querySelectorAll('.katex')).not.toHaveLength(0))
    expect(body().querySelectorAll('.katex')).toHaveLength(1)
    expect(plainText()).toBe('where \\alpha is the angle of the pipe')
  })

  it('shows a formula between $$ lines as one formula, without the $$', async () => {
    // GLM's reading of FM-200 p. 49 (ingestion-service eval/ocr/results/2026-10-10.md).
    const glm =
      'Agent weight:\n$$\n\\mathrm {W} = (\\mathrm {V} / \\mathrm {S}) * (\\mathrm {C} / 1 0 0 - \\mathrm {C})\n$$'
    render(<PassageBody text={glm} quote="" />)
    await waitFor(() => expect(body().querySelectorAll('.katex')).toHaveLength(1))
    expect(plainText()).toBe('Agent weight:\n')
  })

  it('keeps a formula holding the quoted words as written, so they stay marked', async () => {
    render(<PassageBody text={'x = \\sqrt{2}\nC = \\frac{100}{2}'} quote={'C = \\frac{100}{2}'} />)
    await waitFor(() => expect(body().querySelectorAll('.katex')).toHaveLength(1))
    expect(body().querySelector('mark')).toHaveTextContent('C = \\frac{100}{2}')
  })
})
