// Tests for the standards banner (GN-16 AC5).
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReviewSection } from '../api'
import { StandardsBanner } from './StandardsBanner'

afterEach(cleanup)
const sec = (id: string, cites: boolean): ReviewSection =>
  ({
    id,
    sources: { 'C:s': { id: 'C:s', kind: 'standard' } },
    draft: {
      subsections: [
        {
          statements: [{ citations: cites ? ['C:s'] : [], review: { state: 'pending' } }],
        },
      ],
    },
  }) as unknown as ReviewSection

describe('StandardsBanner', () => {
  it('is hidden when no evidence section is drafted', () => {
    const { container } = render(<StandardsBanner sections={[]} target={50} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('warns in amber below target', () => {
    render(
      <StandardsBanner sections={[sec('7', true), sec('8', false), sec('9', false)]} target={50} />,
    )
    expect(screen.getByText('1 of 3 sections cite a standard (target 50%)')).toBeInTheDocument()
    expect(screen.getByText('Below target. Drafts still go ahead.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveClass('st-warn')
  })
  it('is neutral at the target exactly and above it', () => {
    render(<StandardsBanner sections={[sec('7', true), sec('8', false)]} target={50} />)
    expect(screen.getByText('1 of 2 sections cite a standard (target 50%)')).toBeInTheDocument()
    expect(screen.queryByText(/Below target/)).toBeNull()
    expect(screen.getByRole('status')).not.toHaveClass('st-warn')
  })
})
