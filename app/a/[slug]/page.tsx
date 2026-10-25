import { cookies } from "next/headers"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import type { Metadata } from "next"
import { getArtifactMeta } from "@/lib/artifacts"
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth"
import { rawArtifactPath } from "@/lib/serve"
import { storageConfigured } from "@/lib/store"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)
}

export default async function ArtifactViewer({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const jar = await cookies()
  if (!verifySessionValue(jar.get(SESSION_COOKIE)?.value)) {
    redirect(`/?next=${encodeURIComponent(`/a/${slug}`)}`)
  }
  if (!storageConfigured()) {
    return (
      <main className="plain">
        <p>Storage is not configured on this deployment.</p>
      </main>
    )
  }

  const meta = await getArtifactMeta(slug)
  if (!meta) notFound()

  const raw = rawArtifactPath(meta.slug, meta.entry)

  return (
    <main className="viewer">
      <header className="viewer-bar">
        <div className="viewer-title">
          <Link className="back" href="/" aria-label="Back to artifacts">
            ←
          </Link>
          <h1 title={meta.title}>{meta.title}</h1>
        </div>
        <div className="viewer-meta">
          <span className="muted small">{formatDate(meta.createdAt)}</span>
          <a className="btn small" href={raw} target="_blank" rel="noreferrer noopener">
            New tab
          </a>
        </div>
      </header>
      <iframe
        className="viewer-frame"
        src={raw}
        title={meta.title}
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
        referrerPolicy="no-referrer"
      />
    </main>
  )
}
