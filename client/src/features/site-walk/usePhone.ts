// Whether the window is phone-wide (under 760px, the app's mobile break, as
// useAssessmentWorkflow.tsx's `phone`). Used by screens/Review.tsx.
import { useEffect, useState } from 'react'

const isPhone = () => typeof window !== 'undefined' && window.innerWidth < 760

// Returns true on a phone, and follows the window as it is resized or turned.
export function usePhone() {
  const [phone, setPhone] = useState(isPhone)
  useEffect(() => {
    const update = () => setPhone(isPhone())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return phone
}
