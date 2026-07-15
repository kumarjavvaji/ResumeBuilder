/** djb2 hash of jdText — deterministic, no crypto API, works on client and server. */
export function computeJdHash(jdText: string): string {
  let h = 5381
  for (let i = 0; i < jdText.length; i++) {
    h = ((h << 5) + h) ^ jdText.charCodeAt(i)
    h = h >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Derive a stable slug-ID from a requirement's text. Deterministic, no collisions for typical lengths. */
export function requirementTextToId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48)
  // Append length to reduce collision risk on trimmed texts
  return `${slug}-${text.length}`
}
