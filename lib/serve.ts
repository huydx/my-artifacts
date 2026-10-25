import { getArtifactMeta } from "./artifacts"
import { contentTypeFor } from "./mime"
import { encodePath, fileKey, normalizeRelPath, SLUG_RE } from "./paths"
import { getStore } from "./store"

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": [
    "default-src 'none'",
    "img-src * data: blob:",
    "media-src * data: blob:",
    "style-src * 'unsafe-inline'",
    "script-src * 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    "font-src * data:",
    "connect-src *",
    "frame-src * data: blob:",
    "worker-src * data: blob:",
    "child-src * data: blob:",
    "base-uri 'none'",
    "form-action *",
    "frame-ancestors 'self'",
  ].join("; "),
}

export function rawArtifactPath(slug: string, entry: string): string {
  return `/api/artifacts/${slug}/${encodePath(entry)}`
}

export async function serveArtifactEntry(slug: string): Promise<Response> {
  if (!SLUG_RE.test(slug)) return new Response("Not found", { status: 404 })
  const meta = await getArtifactMeta(slug)
  if (!meta) return new Response("Not found", { status: 404 })
  return new Response(null, {
    status: 307,
    headers: { Location: rawArtifactPath(slug, meta.entry), ...SECURITY_HEADERS },
  })
}

export async function serveArtifactFile(slug: string, segments: string[]): Promise<Response> {
  if (!SLUG_RE.test(slug)) return new Response("Not found", { status: 404 })
  if (segments.length === 0) return serveArtifactEntry(slug)

  let relPath: string | null = null
  try {
    relPath = normalizeRelPath(segments.join("/"))
  } catch {
    return new Response("Bad request", { status: 400 })
  }
  if (!relPath) return new Response("Bad request", { status: 400 })

  const store = getStore()
  const object = await store.get(fileKey(slug, relPath))
  if (!object) return new Response("Not found", { status: 404 })

  const type = object.contentType || contentTypeFor(relPath)
  return new Response(new Uint8Array(object.data), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": type,
      "Content-Length": String(object.data.byteLength),
    },
  })
}
