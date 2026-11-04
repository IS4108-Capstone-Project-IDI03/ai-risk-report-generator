// A client's initials in a coloured avatar (CP-23): large on the client page's
// header, small on the Clients table. Used by ClientHeader, ClientTable,
// assessments/components/ClientGroup and new-assessment/components/ContactsEditor.
import '../clients.css'
import '../client-record.css'

// Up to two initials: "Nanyang Tech University" gives NT. Words without a
// letter (an emoji) are skipped; Array.from takes a whole character, where
// w[0] split an emoji in half and showed "�".
/** Returns up to two initials of a name, e.g. NT. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => Array.from(w)[0].toUpperCase())
    .join('')

// A colour for the avatar, picked from the name so a client keeps its own.
const tone = (name: string) => Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0) % 5

export function ClientAvatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      className={small ? 'client-avatar client-avatar--sm' : 'client-avatar'}
      data-tone={tone(name)}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
