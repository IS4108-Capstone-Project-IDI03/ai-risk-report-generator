// Settings > Password: change my own password. S-01 AC2.
// Called by Settings.tsx. Calls POST /api/auth/change-password.
import { useState } from 'react'
import { Button, Icon, Input } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { PASSWORD_RULE } from '../../auth/passwordRule'
import { changePassword } from '../api'

export function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setDone(false)
    setFields({})
    setProblem('')
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setDone(true)
    } catch (error) {
      if (error instanceof GatewayError) {
        setFields(error.fields)
        // 429 is the lockout after too many wrong tries; show its message under the form.
        if (error.status === 429 || !Object.keys(error.fields).length) setProblem(error.message)
      } else setProblem('Could not change the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="st-form" onSubmit={submit} noValidate>
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        error={fields.currentPassword}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        value={next}
        error={fields.newPassword}
        onChange={(e) => setNext(e.target.value)}
      />
      <p className="st-note">{PASSWORD_RULE}</p>
      {problem && (
        <p className="st-err" role="alert">
          <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
        </p>
      )}
      {done && (
        <p className="st-status" role="status">
          <Icon name="check" size={14} color="var(--green-600)" /> Password changed
        </p>
      )}
      <Button type="submit" loading={busy}>
        Change password
      </Button>
    </form>
  )
}
