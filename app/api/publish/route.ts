import { NextResponse, type NextRequest } from "next/server"
import { publishArtifact, artifactUrls, MAX_FILES, MAX_TOTAL_BYTES } from "@/lib/artifacts"
import { verifyPublishToken } from "@/lib/auth"
import { clientIp, rateLimit } from "@/lib/ratelimit"
import { storageConfigured } from "@/lib/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const ip = clientIp(request)
  if (!rateLimit(`publish:${ip}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many publish requests, slow down." }, { status: 429 })
  }
  if (!process.env.ARTIFACTS_PUBLISH_TOKEN) {
    return NextResponse.json({ error: "Server is missing ARTIFACTS_PUBLISH_TOKEN." }, { status: 503 })
  }
  if (!verifyPublishToken(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  if (!storageConfigured()) {
    return NextResponse.json({ error: "Storage is not configured on the server." }, { status: 503 })
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (contentLength > MAX_TOTAL_BYTES + 64 * 1024) {
    return NextResponse.json(
      { error: `Payload too large. Limit is ${MAX_TOTAL_BYTES} bytes across at most ${MAX_FILES} files.` },
      { status: 413 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 })
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 })
  }

  try {
    const { meta } = await publishArtifact(body as Record<string, unknown>)
    const urls = artifactUrls(meta.slug, meta.entry, request.nextUrl.origin)
    return NextResponse.json(
      {
        slug: meta.slug,
        title: meta.title,
        entry: meta.entry,
        url: urls.url,
        rawUrl: urls.rawUrl,
        files: meta.files.length,
        size: meta.size,
        createdAt: meta.createdAt,
      },
      { status: 201 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
