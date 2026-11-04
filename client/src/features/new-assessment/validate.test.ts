// A date typed wrongly blocks Create with its own line (CP-23 AC19). Tests validate.ts.
import { describe, expect, it } from 'vitest'
import { blankForm } from './form'
import { INVALID_DATE, validate } from './validate'

describe('validate', () => {
  it('says "Enter a date as dd/mm/yyyy" for a date whose typed text is not a date', () => {
    const form = blankForm()
    const path = 'sites.0.assessments.0.siteVisitDate'
    expect(validate(form, 'Acme', undefined, new Set([path]))[path]).toBe(INVALID_DATE)
    expect(INVALID_DATE).toBe('Enter a date as dd/mm/yyyy')
  })
})
