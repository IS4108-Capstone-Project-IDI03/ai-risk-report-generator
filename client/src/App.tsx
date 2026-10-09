import { useEffect, useState } from 'react'
import { SignIn } from './features/auth/SignIn'
import { useIdleTimeout } from './features/auth/useIdleTimeout'
import { currentSession, signOut, type Session } from './features/auth/api'
import { AssessmentApp } from './features/assessments/AssessmentApp'
import { SESSION_ENDED_EVENT } from './features/assessments/api'
import { useAssessmentWorkflow } from './features/assessments/useAssessmentWorkflow'

function Workspace({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const workflow = useAssessmentWorkflow(onSignOut, session)
  useIdleTimeout(onSignOut)
  return <AssessmentApp v={workflow} session={session} />
}

// Every workspace URL needs a session (F-04): without one the sign-in screen
// shows, and signing in opens the URL that was asked for, if the role may
// (F-05).
export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  // A session the browser already holds, e.g. after a refresh.
  useEffect(() => {
    const controller = new AbortController()
    currentSession(controller.signal).then(
      (existing) => {
        if (existing) setSession((current) => current ?? existing)
      },
      () => {
        // Unreachable gateway or no session: stay on the sign-in screen.
      },
    )
    return () => controller.abort()
  }, [])

  // The gateway answered 401 to some request: the session expired.
  useEffect(() => {
    const ended = () => setSession(null)
    window.addEventListener(SESSION_ENDED_EVENT, ended)
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended)
  }, [])

  function leave() {
    setSession(null)
    // The next person to sign in starts from their own home screen.
    window.history.replaceState(null, '', '/')
    signOut().catch(() => {
      // The cookie expires on its own; nothing else to undo.
    })
  }

  return session ? (
    <Workspace key={session.user.id} session={session} onSignOut={leave} />
  ) : (
    <SignIn onSignIn={setSession} />
  )
}
