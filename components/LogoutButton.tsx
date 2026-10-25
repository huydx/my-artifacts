"use client"

import { useState } from "react"

export function LogoutButton() {
  const [busy, setBusy] = useState(false)

  async function onLogout() {
    setBusy(true)
    try {
      await fetch("/api/logout", { method: "POST" })
      window.location.href = "/"
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn ghost" type="button" onClick={onLogout} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  )
}
