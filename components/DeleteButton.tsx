"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

export function DeleteButton({ slug }: { slug: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onDelete() {
    if (!window.confirm("Delete this artifact permanently?")) return
    setBusy(true)
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(slug)}`, { method: "DELETE" })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        window.alert(body?.error ?? "Delete failed.")
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn danger" type="button" onClick={onDelete} disabled={busy}>
      {busy ? "Deleting…" : "Delete"}
    </button>
  )
}
