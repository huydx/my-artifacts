import { NextResponse, type NextRequest } from "next/server"
import { createSessionValue, passphraseConfigured, SESSION_COOKIE, sessionTtlMs, safeNextPath, verifyPassphrase } from "@/lib/auth"
import { clientIp, rateLimit } from "@/lib/ratelimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request)
  if (!rateLimit(`login:${ip}`, 8, 10 * 60 * 1000)) {
    return NextResponse.redirect(new URL("/?error=rate", request.url), 303)
  }
  if (!passphraseConfigured()) {
    return NextResponse.redirect(new URL("/?error=config", request.url), 303)
  }

  const form = await request.formData()
  const passphrase = form.get("passphrase")
  const next = safeNextPath(form.get("next"))

  await sleep(300)

  if (!verifyPassphrase(passphrase)) {
    const failed = new URL("/", request.url)
    failed.searchParams.set("error", "invalid")
    if (next !== "/") failed.searchParams.set("next", next)
    return NextResponse.redirect(failed, 303)
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303)
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionValue(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(sessionTtlMs() / 1000),
  })
  return response
}
