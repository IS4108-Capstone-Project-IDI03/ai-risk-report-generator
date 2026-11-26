// The knowledge chat's answer turn (CB-01): an answer stopped before its first word shows no
// MarshBot logo, so no empty turn is drawn.
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { AnswerTurn } from './components/AnswerTurn'

afterEach(cleanup)

describe('Knowledge chat answer turn', () => {
  it('draws no MarshBot logo for an answer stopped before its first word', () => {
    const { container } = render(
      <AnswerTurn message={{ id: 'a1', role: 'assistant', content: '' }} isStreaming={false} />,
    )
    expect(screen.queryByRole('img', { name: 'MarshBot' })).toBeNull()
    // The bare content box stays, so Try again can still be drawn under the question.
    expect(
      container.querySelector('.openui-shell-thread-message-assistant__content'),
    ).not.toBeNull()
  })

  it('shows the MarshBot logo while the answer is still to come', () => {
    render(<AnswerTurn message={{ id: 'a1', role: 'assistant', content: '' }} isStreaming />)
    expect(screen.getByRole('img', { name: 'MarshBot' })).toBeInTheDocument()
  })
})
