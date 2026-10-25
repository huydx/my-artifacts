import { NextResponse, type NextRequest } from "next/server"
import { deleteArtifact } from "@/lib/artifacts"
import { SESSION_COOKIE, verifyPublishToken, verifySessionValue } from "@/lib/auth"
import { clientIp, rateLimit, sameOrigin } from "@/lib/ratelimit"
import { serveArtifactEntry } from "@/lib/serve"
import { storageConfigured } from "@/lib/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  if (!storageConfigured()) return new Response("Storage is not configured", { status: 503 })
  if (!verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value)) {
    return new Response("Unauthorized", { status: 401 })
  }
  const { slug } = await context.params
  return serveArtifactEntry(slug)
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 })
  }
  const ip = clientIp(request)
  if (!rateLimit(`delete:${ip}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }
  if (!storageConfigured()) {
    return NextResponse.json({ error: "Storage is not configured on the server." }, { status: 503 })
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value
  const authorized = verifySessionValue(session) || verifyPublishToken(request.headers.get("authorization"))
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { slug } = await context.params
  const deleted = await deleteArtifact(slug)
  if (!deleted) return NextResponse.json({ error: "Artifact not found." }, { status: 404 })
  return NextResponse.json({ ok: true, slug })
}
