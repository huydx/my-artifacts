import Link from "next/link"

export default function NotFound() {
  return (
    <main className="plain">
      <div className="empty">
        <h2>Artifact not found</h2>
        <p className="muted">The link is wrong, or the artifact was deleted.</p>
        <Link className="btn" href="/">
          Back to artifacts
        </Link>
      </div>
    </main>
  )
}
