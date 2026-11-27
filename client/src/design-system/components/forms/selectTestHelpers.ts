// Test helpers for the design system's Select (our own dropdown, not a native select): find a
// field, choose an option from its list, and read what it shows. Used by feature tests.
import { fireEvent, screen, within } from '@testing-library/react'

type Name = string | RegExp

/** Returns the Select field named `name` (its label or aria-label), in `scope` or the page. */
export const selectField = (name: Name, scope: HTMLElement = document.body) =>
  within(scope).getByRole('combobox', { name })

/** Opens the Select named `name` and chooses the option whose words are `option`. */
export function chooseOption(name: Name, option: Name, scope: HTMLElement = document.body) {
  const field = selectField(name, scope)
  fireEvent.click(field)
  // The open list is the element the field controls (a popover; a sheet on a phone is the page's
  // only listbox).
  const id = field.getAttribute('aria-controls')
  const list = (id && document.getElementById(id)) || screen.getByRole('listbox')
  fireEvent.click(within(list).getByRole('option', { name: option }))
}

/** Returns the options a Select lists, by their words, opening and closing it. */
export function optionWords(name: Name, scope: HTMLElement = document.body) {
  const field = selectField(name, scope)
  fireEvent.click(field)
  const id = field.getAttribute('aria-controls')
  const list = (id && document.getElementById(id)) || screen.getByRole('listbox')
  const words = within(list)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '')
  fireEvent.click(field)
  return words
}
