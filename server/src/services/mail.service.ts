import nodemailer from 'nodemailer'
import { config } from '../config'

// Whether email really leaves the server. Without SMTP_HOST, the console is
// the only inbox, so the password reset (F-06) and the invitation (F-08) print
// their codes there instead.
export function mailIsConfigured(): boolean {
  return Boolean(config.smtp.host)
}

// Real SMTP when SMTP_HOST is set, otherwise jsonTransport, which never leaves
// the server: it hands back the composed message instead of delivering it, so
// CI and fresh checkouts need no mail server. Built per send so the settings
// are read when used, not frozen at import.
function mailTransport() {
  const { host, port, user, pass } = config.smtp
  if (!host) return nodemailer.createTransport({ jsonTransport: true })
  // Port 587 starts plain, then upgrades to TLS (STARTTLS); nodemailer does it.
  // Timeouts: without them a dead mail server would hang the request for ~2 minutes.
  return nodemailer.createTransport({
    host,
    port,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 10_000,
  })
}

// Sends one plain-text email from SMTP_FROM. Throws when the mail server
// refuses it or can't be reached; each caller decides what that means.
export async function sendMail(message: { to: string; subject: string; text: string }) {
  await mailTransport().sendMail({ from: config.smtp.from, ...message })
}
