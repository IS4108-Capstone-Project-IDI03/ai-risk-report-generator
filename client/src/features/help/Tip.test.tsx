// F-13 test seams 1 and 3: Tip hides for the wrong role, draws its words with MarshBot's text
// rules, shows Show me only when the walkthrough can play and starts it, and the moved tips keep
// their words.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const engine = vi.hoisted(() => ({ canPlay: vi.fn(() => true), play: vi.fn() }))
vi.mock('../walkthrough/engine', async (original) => ({
  ...(await original<typeof import('../walkthrough/engine')>()),
  ...engine,
}))
import { useWalkthroughs } from '../walkthrough/engine'
import { Tip } from './Tip'

const as = (role: 'risk_engineer' | 'knowledge_admin') => useWalkthroughs.setState({ role })
beforeEach(() => {
  engine.canPlay.mockReturnValue(true)
  as('risk_engineer')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Tip', () => {
  it('draws paragraphs, bullets and bold like MarshBot’s bubble', () => {
    render(<Tip id="review.findings" />)
    fireEvent.click(screen.getByRole('button', { name: 'How to review the draft' }))
    const body = screen.getByRole('dialog')
    expect(body.querySelectorAll('ul > li')).toHaveLength(3)
    expect(body.querySelectorAll('p')).toHaveLength(2)
    expect(body.querySelector('li b')).toHaveTextContent('Accept')
    expect(body).toHaveTextContent("Bulk accept accepts every finding you haven't decided yet.")
  })

  it('renders nothing for a role the tip is not for', () => {
    as('knowledge_admin')
    const { container } = render(<Tip id="review.findings" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Show me for a named walkthrough the role can play, and plays it', () => {
    render(<Tip id="review.findings" />)
    fireEvent.click(screen.getByRole('button', { name: 'How to review the draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }))
    expect(engine.canPlay).toHaveBeenCalledWith('review')
    expect(engine.play).toHaveBeenCalledWith(['review'])
  })

  it('hides Show me when the walkthrough cannot play for this role', () => {
    engine.canPlay.mockReturnValue(false)
    render(<Tip id="review.findings" />)
    fireEvent.click(screen.getByRole('button', { name: 'How to review the draft' }))
    expect(screen.queryByRole('button', { name: 'Show me' })).not.toBeInTheDocument()
  })

  it('has no Show me when the tip names no walkthrough', () => {
    render(<Tip id="review.regenerate" />)
    fireEvent.click(screen.getByRole('button', { name: 'About regenerating a section' }))
    expect(screen.queryByRole('button', { name: 'Show me' })).not.toBeInTheDocument()
  })

  it('takes its words as children for a tip that exists today', () => {
    render(
      <Tip id="new-observation.capture">
        <p>Pick the location you are standing in.</p>
      </Tip>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'How to add an observation' }))
    expect(screen.getByText('Pick the location you are standing in.')).toBeInTheDocument()
  })
})
