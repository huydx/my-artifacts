import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { del, get, list, put } from "@vercel/blob"
import { contentTypeFor } from "./mime"

export type StoredObject = {
  data: Buffer
  contentType: string
}

export interface ArtifactStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  list(prefix: string): Promise<string[]>
  del(prefix: string): Promise<void>
}

function localRoot(): string | null {
  const dir = process.env.ARTIFACTS_LOCAL_DIR
  if (!dir) return null
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), dir)
}

function resolveInside(root: string, key: string): string {
  const target = path.resolve(/* turbopackIgnore: true */ root, key)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Refusing to access a path outside the local artifact directory")
  }
  return target
}

class LocalStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    const target = resolveInside(this.root, key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data)
  }

  async get(key: string): Promise<StoredObject | null> {
    const target = resolveInside(this.root, key)
    try {
      const info = await stat(target)
      if (!info.isFile()) return null
      return { data: await readFile(target), contentType: contentTypeFor(key) }
    } catch {
      return null
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = resolveInside(this.root, prefix)
    const keys: string[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (entry.isFile()) {
          keys.push(path.relative(this.root, full).split(path.sep).join("/"))
        }
      }
    }
    await walk(base)
    return keys
  }

  async del(prefix: string): Promise<void> {
    const target = resolveInside(this.root, prefix)
    await rm(target, { recursive: true, force: true })
  }
}

class BlobStore implements ArtifactStore {
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await put(key, data, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    })
  }

  async get(key: string): Promise<StoredObject | null> {
    const result = await get(key, { access: "private", useCache: false })
    if (!result) return null
    if (result.statusCode !== 200) return null
    const data = Buffer.from(await new Response(result.stream).arrayBuffer())
    return { data, contentType: result.blob.contentType || contentTypeFor(key) }
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({ prefix, cursor, limit: 1000 })
      for (const blob of page.blobs) keys.push(blob.pathname)
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return keys
  }

  async del(prefix: string): Promise<void> {
    const keys = await this.list(prefix)
    if (keys.length === 0) return
    await del(keys)
  }
}

export function storageConfigured(): boolean {
  return Boolean(localRoot() || process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN)
}

export function getStore(): ArtifactStore {
  const root = localRoot()
  if (root) return new LocalStore(root)
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error("Storage is not configured. Set BLOB_READ_WRITE_TOKEN (Vercel Blob) or ARTIFACTS_LOCAL_DIR.")
  }
  return new BlobStore()
}
