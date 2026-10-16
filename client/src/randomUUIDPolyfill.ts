// Browsers expose crypto.randomUUID only in secure contexts (HTTPS or localhost), so on a
// plain-HTTP deployment it is undefined and OpenUI's composer throws when it makes message
// ids. crypto.getRandomValues works in any context, so build an RFC 4122 v4 id from it.
// Imported first by main.tsx, before anything that might call randomUUID.
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = function randomUUID() {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`
  }
}
