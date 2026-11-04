// File tile (CP-23, v2 section 6): a 32 px tile coloured by file type.
// Called by the documents popover, the client Documents tab and the reading screen. Calls Icon.
import { Icon } from '../core/Icon'

export type FileKind = 'email' | 'pdf' | 'word' | 'text' | 'unknown'

export type FileTileProps = {
  // File name ("Policy.pdf") used to pick the kind.
  name?: string
  // Or a content type ("application/pdf"); wins over the name when it is known.
  contentType?: string
  // Forces the kind (skips detection).
  kind?: FileKind
}

/** Returns the kind of file for a name and/or content type; unknown for anything else. */
export function fileKind(name = '', contentType = ''): FileKind {
  const type = contentType.toLowerCase()
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (
    type.includes('wordprocessingml') ||
    type === 'application/msword' ||
    ['doc', 'docx'].includes(ext)
  )
    return 'word'
  if (type === 'message/rfc822' || type.includes('ms-outlook') || ['eml', 'msg'].includes(ext))
    return 'email'
  if (type.startsWith('text/') || ['txt', 'md', 'csv'].includes(ext)) return 'text'
  return 'unknown'
}

const KINDS: Record<FileKind, { icon: string; fg: string; bg: string }> = {
  email: { icon: 'mail', fg: 'var(--violet-600)', bg: 'var(--violet-50)' },
  pdf: { icon: 'file-text', fg: 'var(--red-600)', bg: 'var(--red-50)' },
  word: { icon: 'file-text', fg: 'var(--ink-600)', bg: 'var(--ink-50)' },
  text: { icon: 'file-text', fg: 'var(--graphite-700)', bg: 'var(--graphite-100)' },
  unknown: { icon: 'file', fg: 'var(--graphite-700)', bg: 'var(--graphite-100)' },
}

/** Returns the file tile; its data-kind says which kind was chosen. */
export function FileTile({ name, contentType, kind }: FileTileProps) {
  const k = kind ?? fileKind(name, contentType)
  const t = KINDS[k]
  return (
    <span className="ds-file-tile" data-kind={k} style={{ color: t.fg, background: t.bg }}>
      <Icon name={t.icon} size={16} />
    </span>
  )
}
