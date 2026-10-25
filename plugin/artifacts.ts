import { readFile, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

const MAX_FILES = 200
const MAX_TOTAL_BYTES = 4 * 1024 * 1024

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  ".turbo",
  ".cache",
  ".artifacts-local",
  ".DS_Store",
])

const TEXT_EXTENSIONS = new Set([
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "json",
  "map",
  "txt",
  "md",
  "csv",
  "xml",
  "svg",
  "ts",
  "tsx",
  "jsx",
  "yml",
  "yaml",
  "toml",
  "ini",
  "sh",
  "webmanifest",
])

type Config = { url: string; token: string }

type CollectedFile = { path: string; content: string; encoding: "utf8" | "base64"; size: number }

type WalkResult = { root: string; files: CollectedFile[]; total: number }

async function readConfigFile(): Promise<Partial<Config>> {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config")
  const candidates = [
    path.join(configHome, "opencode", "artifacts.json"),
    path.join(configHome, "opencode", "artifacts.jsonc"),
  ]
  for (const file of candidates) {
    try {
      const text = await readFile(file, "utf8")
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === "object") return parsed as Partial<Config>
    } catch {
      continue
    }
  }
  return {}
}

async function resolveConfig(): Promise<Config> {
  const file = await readConfigFile()
  const url = (process.env.ARTIFACTS_URL || file.url || "").replace(/\/+$/, "")
  const token = process.env.ARTIFACTS_PUBLISH_TOKEN || file.token || ""
  if (!url || !token) {
    throw new Error(
      "Artifact host is not configured. Set ARTIFACTS_URL and ARTIFACTS_PUBLISH_TOKEN, " +
        "or create ~/.config/opencode/artifacts.json with {\"url\": \"https://...\", \"token\": \"...\"}.",
    )
  }
  if (!/^https?:\/\//.test(url)) {
    throw new Error(`ARTIFACTS_URL must start with http:// or https:// (got "${url}").`)
  }
  return { url, token }
}

function looksBinary(buffer: Buffer, filePath: string): boolean {
  if (buffer.includes(0)) return true
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return false
  return buffer.subarray(0, 4096).some((byte) => byte < 7 || (byte > 14 && byte < 32))
}

async function collect(inputPath: string): Promise<WalkResult> {
  const resolved = path.resolve(inputPath)
  const info = await stat(resolved)
  const files: CollectedFile[] = []

  if (info.isFile()) {
    if (info.size > MAX_TOTAL_BYTES) {
      throw new Error(`Artifact is larger than 4 MB, which is the Vercel request limit.`)
    }
    const file = await readOne(resolved, path.basename(resolved))
    return { root: path.dirname(resolved), files: [file], total: file.size }
  }
  if (!info.isDirectory()) throw new Error(`Not a file or directory: ${resolved}`)

  let total = 0
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = path.relative(resolved, full).split(path.sep).join("/")
      const fileInfo = await stat(full)
      if (fileInfo.size > MAX_TOTAL_BYTES) {
        throw new Error(`File "${rel}" is larger than 4 MB, the Vercel request limit.`)
      }
      const file = await readOne(full, rel)
      total += file.size
      if (files.length + 1 > MAX_FILES) {
        throw new Error(`Too many files to publish (max ${MAX_FILES}). Publish a smaller build output.`)
      }
      if (total > MAX_TOTAL_BYTES) {
        throw new Error(
          `Artifact is larger than 4 MB, which is the Vercel request limit. ` +
            `Try a smaller build (e.g. publish "dist/" instead of "dist/with-assets").`,
        )
      }
      files.push(file)
    }
  }

  await walk(resolved)
  return { root: resolved, files, total }
}

async function readOne(fullPath: string, relPath: string): Promise<CollectedFile> {
  const buffer = await readFile(fullPath)
  if (looksBinary(buffer, fullPath)) {
    return { path: relPath, content: buffer.toString("base64"), encoding: "base64", size: buffer.byteLength }
  }
  return { path: relPath, content: buffer.toString("utf8"), encoding: "utf8", size: buffer.byteLength }
}

function pickEntry(files: CollectedFile[], requested: string | undefined, isSingleFile: boolean): string | undefined {
  if (isSingleFile) return undefined
  if (requested) return requested
  const html = files
    .map((file) => file.path)
    .filter((path) => /\.html?$/i.test(path))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
  return html.find((path) => path === "index.html") ?? html.find((path) => path.endsWith("/index.html")) ?? html[0]
}

function requireSlug(input: string): string {
  const slug = input.trim()
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) throw new Error(`"${input}" is not a valid artifact slug.`)
  return slug
}

async function apiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (body?.error) return body.error
  } catch {
    // ignore
  }
  return `${response.status} ${response.statusText}`
}

export const ArtifactsPlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      publish_artifact: tool({
        description:
          "Publish a generated artifact (an HTML file or a static site directory) to the user's private artifact host. " +
          "Returns an unlisted URL that requires the host passphrase to view. Use this whenever the user asks to share, host, " +
          "preview, or deploy an HTML page, report, dashboard, deck, or static site you generated.",
        args: {
          path: tool.schema.string().describe("File or directory to publish, relative to the project or absolute."),
          title: tool.schema.string().optional().describe("Human-readable title shown in the artifact list."),
          entry: tool.schema
            .string()
            .optional()
            .describe("Entry HTML path relative to the published root. Defaults to index.html."),
        },
        async execute(args) {
          const config = await resolveConfig()
          const target = path.resolve(directory, args.path)
          const info = await stat(target).catch(() => null)
          if (!info) throw new Error(`Path does not exist: ${args.path}`)

          const { files, total } = await collect(target)
          if (files.length === 0) throw new Error(`No publishable files under ${args.path}`)

          const entry = pickEntry(files, args.entry, info.isFile())
          const title = args.title?.trim() || (info.isFile() ? path.basename(target) : path.basename(target) || "Artifact")

          const response = await fetch(`${config.url}/api/publish`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title, entry, source: "opencode", files }),
            signal: AbortSignal.timeout(60_000),
          })

          if (!response.ok) {
            throw new Error(`Publish failed: ${await apiError(response)}`)
          }

          const result = (await response.json()) as {
            url: string
            slug: string
            entry: string
            files: number
            size: number
          }

          const kb = (result.size / 1024).toFixed(1)
          return [
            `Published "${title}"`,
            "",
            `Private URL: ${result.url}`,
            `Entry: ${result.entry} (${result.files} files, ${kb} KB)`,
            "",
            "Anyone opening this link must first enter the host passphrase. The link is unlisted and noindex.",
          ].join("\n")
        },
      }),

      delete_artifact: tool({
        description: "Delete a previously published artifact from the private artifact host by its slug.",
        args: {
          slug: tool.schema.string().describe("Artifact slug (the path segment in /a/<slug>)."),
        },
        async execute(args) {
          const config = await resolveConfig()
          const slug = requireSlug(args.slug)
          const response = await fetch(`${config.url}/api/artifacts/${slug}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${config.token}` },
            signal: AbortSignal.timeout(30_000),
          })
          if (!response.ok) throw new Error(`Delete failed: ${await apiError(response)}`)
          return `Deleted artifact ${slug}.`
        },
      }),
    },
  }
}
