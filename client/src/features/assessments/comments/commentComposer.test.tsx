// The comment box focuses without scrolling (RV-03): the native autoFocus
// fired before the margin placed a new card, so the page jumped to Section 1.
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { CommentComposer } from './CommentComposer'

afterEach(cleanup)

it('focuses the box without scrolling the page', () => {
  const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')
  render(
    <CommentComposer
      label="New comment"
      submitLabel="Comment"
      onSubmit={async () => null}
      autoFocus
    />,
  )
  expect(screen.getByRole('textbox', { name: 'New comment' })).toHaveFocus()
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  focus.mockRestore()
})
