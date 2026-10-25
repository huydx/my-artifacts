import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export const SESSION_COOKIE = "artifacts_session"

const DEFAULT_SESSION_TTL_HOURS = 24 * 7

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    timingSafeEqual(left, left)
    return false
  }
  return timingSafeEqual(left, right)
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

export function passphraseConfigured(): boolean {
  return Boolean(process.env.ARTIFACTS_VIEW_PASSPHRASE && process.env.ARTIFACTS_COOKIE_SECRET)
}

export function verifyPassphrase(input: unknown): boolean {
  const expected = process.env.ARTIFACTS_VIEW_PASSPHRASE
  if (!expected) return false
  if (typeof input !== "string" || input.length === 0) return false
  return safeEqual(input, expected)
}

export function sessionTtlMs(): number {
  const hours = Number(process.env.ARTIFACTS_SESSION_TTL_HOURS)
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000
  return Math.min(hours, 24 * 90) * 60 * 60 * 1000
}

function sign(expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`artifact-session:${expiresAt}`).digest("base64url")
}

export function createSessionValue(now = Date.now()): string {
  const secret = process.env.ARTIFACTS_COOKIE_SECRET
  if (!secret) throw new Error("ARTIFACTS_COOKIE_SECRET is not configured")
  const expiresAt = now + sessionTtlMs()
  return `${expiresAt}.${sign(expiresAt, secret)}`
}

export function verifySessionValue(value: string | undefined, now = Date.now()): boolean {
  const secret = process.env.ARTIFACTS_COOKIE_SECRET
  if (!secret || !value) return false
  const dot = value.indexOf(".")
  if (dot < 1) return false
  const expiresAt = Number(value.slice(0, dot))
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false
  return safeEqual(value.slice(dot + 1), sign(expiresAt, secret))
}

export function verifyPublishToken(authorization: string | null): boolean {
  const expected = process.env.ARTIFACTS_PUBLISH_TOKEN
  if (!expected) return false
  if (!authorization) return false
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  const token = match?.[1] ?? ""
  return safeEqual(token, expected)
}

export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/"
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) return "/"
  return value
}
