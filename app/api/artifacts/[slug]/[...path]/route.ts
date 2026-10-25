import { type NextRequest } from "next/server"
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth"
import { storageConfigured } from "@/lib/store"
import { serveArtifactFile } from "@/lib/serve"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string; path: string[] }> }) {
  if (!storageConfigured()) return new Response("Storage is not configured", { status: 503 })
  if (!verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value)) {
    return new Response("Unauthorized", { status: 401 })
  }
  const { slug, path } = await context.params
  return serveArtifactFile(slug, path)
}
