export type ArtifactFile = {
  path: string
  size: number
  type: string
}

export type ArtifactMeta = {
  version: 1
  slug: string
  title: string
  entry: string
  files: ArtifactFile[]
  size: number
  createdAt: string
  source?: string
}

export function isArtifactMeta(value: unknown): value is ArtifactMeta {
  if (!value || typeof value !== "object") return false
  const meta = value as Partial<ArtifactMeta>
  return (
    meta.version === 1 &&
    typeof meta.slug === "string" &&
    typeof meta.title === "string" &&
    typeof meta.entry === "string" &&
    typeof meta.createdAt === "string" &&
    Array.isArray(meta.files)
  )
}
