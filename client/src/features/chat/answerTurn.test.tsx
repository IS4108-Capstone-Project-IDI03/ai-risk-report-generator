// The knowledge chat's answer turn and starter pills (CB-01): an answer stopped before its first
// word shows no MarshBot face, and a starter does nothing while a reply is still being written.
// OpenUI's chat state is a stub.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnswerTurn } from './components/AnswerTurn'
import { Starters } from './components/Starters'

const processMessage = vi.fn()
let isRunning = false
vi.mock('@openuidev/react-headless', async (original) => ({
  ...(await original<object>()),
  useThread: (pick: (s: { processMessage: typeof processMessage; isRunning: boolean }) => unknown) =>
    pick({ processMessage, isRunning }),
}))

afterEach(() => {
  cleanup()
  processMessage.mockClear()
  isRunning = false
})

describe('Knowledge chat answer turn', () => {
  it('draws no MarshBot turn for an answer stopped before its first word', () => {
    const { container } = render(
      <AnswerTurn message={{ id: 'a1', role: 'assistant', content: '' }} isStreaming={false} />,
    )
    expect(screen.queryByLabelText('MarshBot')).toBeNull()
    // The bare body stays, so Try again can still be drawn under the question.
    expect(container.querySelector('.chat-answer-body')).not.toBeNull()
  })

  it('shows MarshBot thinking while the answer is still to come', () => {
    render(<AnswerTurn message={{ id: 'a1', role: 'assistant', content: '' }} isStreaming />)
    expect(screen.getByLabelText('MarshBot')).toBeInTheDocument()
  })
})

describe('Knowledge chat starters', () => {
  it('asks the starter question when no reply is running', () => {
    render(<Starters />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(processMessage).toHaveBeenCalledTimes(1)
  })

  it('sends nothing while a reply is still being written', () => {
    isRunning = true
    render(<Starters />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(processMessage).not.toHaveBeenCalled()
  })
})
