// The rule for a new password: a letter and a number, no length minimum, no symbol (F-08, S-01).
// Used by SetPassword, SignIn (request access) and settings/PasswordSection. Must match
// server/src/services/invitation.service.ts `newPasswordSchema`.
export const PASSWORD_RULE = 'Use at least one letter and one number.'

/** Returns true when `password` has at least one letter and one number. */
export const meetsRule = (password: string) => /[A-Za-z]/.test(password) && /\d/.test(password)
