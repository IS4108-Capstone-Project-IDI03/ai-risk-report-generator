// Avatar (v2 section 3 "Avatars", shared): a name's initials. A person is a light-blue circle
// (the sidebar's account row look); a client is a rounded tile in a colour picked from its name,
// so a client keeps its own colour everywhere. One component so every avatar in the app shares
// its sizes, colours and initials. Called by the sidebar, comments, accounts, clients, MarshBot,
// New Assessment, the engineer picker and the Inbox.
import './avatar.css'

// Up to two initials: "Nanyang Tech University" gives NT. Words without a letter (an emoji) are
// skipped; Array.from takes a whole character, where w[0] split an emoji in half and showed "�".
/** Returns up to two initials of a name, e.g. NT. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => Array.from(w)[0].toUpperCase())
    .join('')

// A client's colour, picked from the name so a client keeps its own.
const tone = (name: string) => Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0) % 5

// The initials' size for the avatar's side: 10 px at 24, up to 15 px at 44.
const fontSize = (size: number) =>
  size <= 24 ? 10 : size <= 28 ? 11 : size <= 32 ? 12 : size <= 40 ? 14 : 15

export type AvatarProps = {
  name: string
  // The side in px: 24 (contacts), 28 (default: rows, comments), 32 (tables, sidebar), 40, 44 (headers).
  size?: number
  // A person (round, light blue) or a client (rounded tile in its own colour).
  kind?: 'person' | 'client'
  className?: string
}

/** Returns a decorative initials avatar (hidden from screen readers: the name beside it says it). */
export function Avatar({ name, size = 28, kind = 'person', className }: AvatarProps) {
  return (
    <span
      className={className ? `ds-avatar ${className}` : 'ds-avatar'}
      data-kind={kind}
      data-tone={kind === 'client' ? tone(name) : undefined}
      data-big={size > 32 || undefined}
      style={{ width: size, height: size, fontSize: fontSize(size) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
