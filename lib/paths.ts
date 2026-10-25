export const SLUG_RE = /^[A-Za-z0-9_-]{16,64}$/

const SEGMENT_RE = /^[A-Za-z0-9._+@ -]+$/

export function normalizeRelPath(input: unknown): string | null {
  if (typeof input !== "string") return null
  const path = input.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!path || path.length > 512) return null
  const parts = path.split("/")
  for (const part of parts) {
    if (!part || part === "." || part === "..") return null
    if (!SEGMENT_RE.test(part)) return null
  }
  return parts.join("/")
}

export function artifactPrefix(slug: string): string {
  return `artifacts/${slug}/`
}

export function metaKey(slug: string): string {
  return `${artifactPrefix(slug)}_meta.json`
}

export function fileKey(slug: string, relPath: string): string {
  return `${artifactPrefix(slug)}files/${relPath}`
}

export function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")
}
