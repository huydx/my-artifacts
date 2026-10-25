import { cookies } from "next/headers"
import { listArtifacts } from "@/lib/artifacts"
import type { ArtifactMeta } from "@/lib/manifest"
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth"
import { storageConfigured } from "@/lib/store"
import { DeleteButton } from "@/components/DeleteButton"
import { LogoutButton } from "@/components/LogoutButton"

export const dynamic = "force-dynamic"

const ERRORS: Record<string, string> = {
  invalid: "That passphrase is not correct.",
  rate: "Too many attempts. Try again in a few minutes.",
  config: "This host is not configured yet.",
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function LoginScreen({ error, next }: { error?: string; next: string }) {
  return (
    <main className="gate">
      <div className="gate-card">
        <div className="gate-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4" y="10" width="16" height="10" rx="2.5" />
            <path d="M8 10V7.5a4 4 0 0 1 8 0V10" strokeLinecap="round" />
            <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <h1>Private artifacts</h1>
        <p className="muted">
          You need the host passphrase to open an artifact. Links are unlisted and indexed by no one.
        </p>
        {error ? <p className="form-error">{ERRORS[error] ?? "Could not sign you in."}</p> : null}
        <form className="gate-form" action="/api/auth" method="post">
          <input type="hidden" name="next" value={next} />
          <label className="field">
            <span>Passphrase</span>
            <input
              type="password"
              name="passphrase"
              autoComplete="current-password"
              autoFocus
              required
              placeholder="Enter passphrase"
            />
          </label>
          <button className="btn primary" type="submit">
            Continue
          </button>
        </form>
        <p className="gate-foot">Sessions last 7 days on this browser.</p>
      </div>
    </main>
  )
}

function ArtifactCard({ meta }: { meta: ArtifactMeta }) {
  return (
    <li className="artifact">
      <div className="artifact-main">
        <a className="artifact-title" href={`/a/${meta.slug}`}>
          {meta.title}
        </a>
        <div className="artifact-meta">
          <span>{formatDate(meta.createdAt)}</span>
          <span className="dot" />
          <span>
            {meta.files.length} {meta.files.length === 1 ? "file" : "files"}
          </span>
          <span className="dot" />
          <span>{formatBytes(meta.size)}</span>
        </div>
      </div>
      <div className="artifact-actions">
        <a className="btn" href={`/a/${meta.slug}`}>
          Open
        </a>
        <DeleteButton slug={meta.slug} />
      </div>
    </li>
  )
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next } = await searchParams
  const jar = await cookies()
  const authenticated = verifySessionValue(jar.get(SESSION_COOKIE)?.value)

  if (!authenticated) {
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
    return <LoginScreen error={error} next={safeNext} />
  }

  let artifacts: ArtifactMeta[] = []
  let storeError: string | null = null
  if (storageConfigured()) {
    try {
      artifacts = await listArtifacts()
    } catch (cause) {
      storeError = cause instanceof Error ? cause.message : "Could not read storage."
    }
  } else {
    storeError = "Storage is not configured. Set BLOB_READ_WRITE_TOKEN (or ARTIFACTS_LOCAL_DIR for local dev)."
  }

  const totalBytes = artifacts.reduce((sum, meta) => sum + meta.size, 0)

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          <span>Artifacts</span>
        </div>
        <div className="topbar-actions">
          <span className="muted small">
            {artifacts.length} {artifacts.length === 1 ? "artifact" : "artifacts"} · {formatBytes(totalBytes)}
          </span>
          <LogoutButton />
        </div>
      </header>

      <section className="content">
        {storeError ? (
          <div className="banner error">
            <strong>Storage unavailable.</strong> {storeError}
          </div>
        ) : null}

        {artifacts.length === 0 && !storeError ? (
          <div className="empty">
            <h2>Nothing published yet</h2>
            <p className="muted">
              Publish from opencode with the <code>publish_artifact</code> tool, or POST to{" "}
              <code>/api/publish</code> with a bearer token.
            </p>
            <details className="snippet">
              <summary>Publish with curl</summary>
              <pre>{`curl -X POST "$ARTIFACTS_URL/api/publish" \\
  -H "Authorization: Bearer $ARTIFACTS_PUBLISH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Hello",
    "files": [{ "path": "index.html", "content": "<h1>Hello</h1>" }]
  }'`}</pre>
            </details>
          </div>
        ) : (
          <ul className="artifact-list">
            {artifacts.map((meta) => (
              <ArtifactCard key={meta.slug} meta={meta} />
            ))}
          </ul>
        )}

        <details className="snippet setup">
          <summary>How publishing works</summary>
          <p className="muted">
            The opencode plugin sends files with <code>ARTIFACTS_PUBLISH_TOKEN</code>. Viewers need the shared
            passphrase, which sets a signed, HttpOnly session cookie. Artifact files live in private Vercel Blob
            storage and are only streamed through authenticated routes.
          </p>
        </details>
      </section>
    </main>
  )
}
