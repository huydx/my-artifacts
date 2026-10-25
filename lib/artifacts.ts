import { randomBytes } from "node:crypto"
import { contentTypeFor } from "./mime"
import { isArtifactMeta, type ArtifactFile, type ArtifactMeta } from "./manifest"
import { artifactPrefix, encodePath, fileKey, metaKey, normalizeRelPath, SLUG_RE } from "./paths"
import { getStore, type ArtifactStore } from "./store"

export const MAX_FILES = 200
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export type PublishFile = {
  path: string
  content: string
  encoding?: "utf8" | "base64"
}

export type PublishInput = {
  title?: unknown
  entry?: unknown
  source?: unknown
  files?: unknown
}

type PreparedFile = {
  path: string
  data: Buffer
  size: number
  type: string
}

function decodeContent(file: PublishFile): Buffer {
  const encoding = file.encoding ?? "utf8"
  if (encoding === "base64") {
    const normalized = file.content.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "")
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
      throw new Error(`File "${file.path}" is not valid base64`)
    }
    return Buffer.from(normalized, "base64")
  }
  return Buffer.from(file.content, "utf8")
}

function pickEntry(files: PreparedFile[], requested: unknown): string {
  const paths = files.map((file) => file.path)
  if (typeof requested === "string" && requested.length > 0) {
    const normalized = normalizeRelPath(requested)
    if (!normalized || !paths.includes(normalized)) {
      throw new Error(`Entry "${requested}" was not included in the uploaded files`)
    }
    return normalized
  }
  const byDepth = (a: string, b: string) => a.split("/").length - b.split("/").length || a.localeCompare(b)
  const html = paths.filter((path) => /\.html?$/i.test(path)).sort(byDepth)
  const rootIndex = html.find((path) => path === "index.html" || path === "index.htm")
  if (rootIndex) return rootIndex
  const anyIndex = html.find((path) => path.endsWith("/index.html") || path.endsWith("/index.htm"))
  if (anyIndex) return anyIndex
  if (html[0]) return html[0]
  if (paths.length === 1) return paths[0]!
  throw new Error("No HTML entry point found. Pass `entry` explicitly.")
}

export type PublishResult = {
  meta: ArtifactMeta
}

export async function publishArtifact(input: PublishInput): Promise<PublishResult> {
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new Error("`files` must be a non-empty array")
  }
  if (input.files.length > MAX_FILES) {
    throw new Error(`Too many files: ${input.files.length} (max ${MAX_FILES})`)
  }

  const seen = new Set<string>()
  const prepared: PreparedFile[] = []
  let total = 0

  for (const raw of input.files) {
    const file = raw as Partial<PublishFile>
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("Each file needs a string `path` and string `content`")
    }
    const path = normalizeRelPath(file.path)
    if (!path) throw new Error(`Invalid file path: ${file.path}`)
    if (seen.has(path)) throw new Error(`Duplicate file path: ${path}`)
    seen.add(path)

    const data = decodeContent({
      path,
      content: file.content,
      encoding: file.encoding === "base64" ? "base64" : "utf8",
    })
    if (data.byteLength > MAX_FILE_BYTES) {
      throw new Error(`File "${path}" is larger than ${MAX_FILE_BYTES} bytes`)
    }
    total += data.byteLength
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`Artifacts are limited to ${MAX_TOTAL_BYTES} bytes total (Vercel request limit)`)
    }
    prepared.push({ path, data, size: data.byteLength, type: contentTypeFor(path) })
  }

  const entry = pickEntry(prepared, input.entry)
  const slug = randomBytes(18).toString("base64url")
  const title =
    typeof input.title === "string" && input.title.trim().length > 0
      ? input.title.trim().slice(0, 120)
      : entry === "index.html"
        ? "Untitled artifact"
        : (entry.split("/").pop() ?? "Untitled artifact")

  const files: ArtifactFile[] = prepared.map(({ path, size, type }) => ({ path, size, type }))
  const meta: ArtifactMeta = {
    version: 1,
    slug,
    title,
    entry,
    files,
    size: total,
    createdAt: new Date().toISOString(),
    source: typeof input.source === "string" ? input.source.slice(0, 120) : "unknown",
  }

  const store = getStore()
  try {
    await mapLimit(prepared, 8, (file) => store.put(fileKey(slug, file.path), file.data, file.type))
    await store.put(metaKey(slug), Buffer.from(JSON.stringify(meta, null, 2)), "application/json")
  } catch (error) {
    await store.del(artifactPrefix(slug)).catch(() => {})
    throw error
  }

  return { meta }
}

export async function getArtifactMeta(slug: string, store: ArtifactStore = getStore()): Promise<ArtifactMeta | null> {
  if (!SLUG_RE.test(slug)) return null
  const object = await store.get(metaKey(slug))
  if (!object) return null
  try {
    const parsed: unknown = JSON.parse(object.data.toString("utf8"))
    if (!isArtifactMeta(parsed) || parsed.slug !== slug) return null
    return parsed
  } catch {
    return null
  }
}

export async function listArtifacts(store: ArtifactStore = getStore()): Promise<ArtifactMeta[]> {
  const keys = await store.list("artifacts/")
  const metaKeys = keys.filter((key) => key.endsWith("/_meta.json"))
  const metas = await mapLimit(metaKeys, 8, async (key) => {
    const slug = key.split("/")[1]
    if (!slug) return null
    return getArtifactMeta(slug, store)
  })
  return metas
    .filter((meta): meta is ArtifactMeta => meta !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function deleteArtifact(slug: string, store: ArtifactStore = getStore()): Promise<boolean> {
  if (!SLUG_RE.test(slug)) return false
  const meta = await getArtifactMeta(slug, store)
  if (!meta) return false
  await store.del(artifactPrefix(slug))
  return true
}

export function artifactUrls(slug: string, entry: string, origin: string): { url: string; rawUrl: string } {
  const base = (process.env.ARTIFACTS_PUBLIC_URL ?? origin).replace(/\/+$/, "")
  return {
    url: `${base}/a/${slug}`,
    rawUrl: `${base}/api/artifacts/${slug}/${encodePath(entry)}`,
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current]!)
    }
  })
  await Promise.all(workers)
  return results
}
