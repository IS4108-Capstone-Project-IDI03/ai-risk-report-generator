// Adds a team member's account (F-08). Nothing is saved until the gateway accepts every field;
// each field it rejects shows its own problem. Once it does, the gateway emails them an
// invitation to set their password. Called by UserAccounts.tsx. Calls createUser (api.ts).
import { useLayoutEffect, useRef, useState } from 'react'
import { Callout, FormActionBar } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { createUser, type NewUserAccount, type UserAccount } from '../api'
import { EMPTY_ACCOUNT, NEW_ROLE_OPTIONS, problem } from '../accountFormat'
import { AccountFields } from '../components/AccountFields'
import { AccountsHeader } from '../components/AccountsHeader'

export function NewAccount({
  onCreated,
  onCancel,
  bell,
}: {
  onCreated: (user: UserAccount) => void
  onCancel: () => void
  bell?: React.ReactNode
}) {
  const [draft, setDraft] = useState<NewUserAccount>(EMPTY_ACCOUNT)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  // Move focus to the first field the gateway rejected. A layout effect, so it lands in the same
  // commit that marks the fields invalid, before the error can be read out without it.
  useLayoutEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [fieldErrors])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      onCreated(await createUser(draft))
    } catch (error: unknown) {
      if (error instanceof GatewayError && Object.keys(error.fields).length > 0) {
        setFieldErrors(error.fields)
        setSaveError('Correct the highlighted fields, then add the account again.')
      } else {
        setFieldErrors({})
        setSaveError(problem(error, 'the account was not added'))
      }
      setSaving(false)
    }
  }

  return (
    <div className="accounts-page">
      <AccountsHeader
        title="Add account"
        helper="They are emailed a link to set their password, and the staff ID is assigned for you."
        back={{ label: 'Back to accounts', onClick: onCancel }}
        bell={bell}
      />
      <div className="accounts">
        <section className="accounts-card" aria-label="Add account">
          <form ref={formRef} noValidate onSubmit={save}>
            <AccountFields
              values={draft}
              errors={fieldErrors}
              roleOptions={NEW_ROLE_OPTIONS}
              onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
            />
            {saveError && (
              <div className="accounts-body-note">
                <Callout tone="danger" title="Account not added">
                  {saveError}
                </Callout>
              </div>
            )}
          </form>
        </section>
      </div>
      <FormActionBar
        onCancel={onCancel}
        primaryLabel="Add account"
        primaryLoading={saving}
        onPrimary={() => formRef.current?.requestSubmit()}
      />
    </div>
  )
}
