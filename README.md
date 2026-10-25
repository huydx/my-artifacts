# my-artifacts

Private, Claude-Artifacts-style hosting for anything opencode generates — HTML pages, reports,
dashboards, static sites — on your own Vercel project.

- **Publish from opencode** with a `publish_artifact` tool.
- **Share an unlisted link** like `https://your-project.vercel.app/a/<slug>`.
- **Gate viewing behind one passphrase.** No passphrase, no content.
- **Artifacts are never public.** Files live in private Vercel Blob storage and are streamed only
  through authenticated routes.
- **Artifact JS is isolated** in a sandboxed iframe without same-origin access.

## How it works

```
opencode plugin ──Bearer ARTIFACTS_PUBLISH_TOKEN──▶ POST /api/publish
                                                          │
                                                          ▼
                                                Vercel Blob (private)
                                                          ▲
browser ──passphrase──▶ signed HttpOnly cookie ──▶ /a/<slug>
                                                       │
                                                       └─▶ sandboxed iframe
                                                              └─▶ /api/artifacts/<slug>/<file>
                                                                  (cookie checked again)
```

- **Publishing** requires a long-lived bearer token (`ARTIFACTS_PUBLISH_TOKEN`).
- **Viewing** requires `ARTIFACTS_VIEW_PASSPHRASE`, exchanged for an HMAC-signed, HttpOnly,
  SameSite=Lax cookie (7 days by default).
- **Slugs** are 144-bit random values, so links are unguessable even before the passphrase gate.
- **Raw files** are served with `no-store`, `nosniff`, a restrictive CSP, `frame-ancestors 'self'`,
  and `noindex`.
- **Deletion** is available to signed-in viewers in the dashboard and to the plugin via the bearer
  token.

## Deploy to Vercel

1. Install and link the project:

   ```bash
   npm install
   vercel link
   ```

2. Create a **private** Blob store and connect it to this project. Private access is required —
   a public store will reject these uploads.

   Dashboard: **Storage → Create → Blob → set Access to Private → Connect to project.**

   Or with the CLI:

   ```bash
   vercel blob create-store my-private-artifacts --access private --yes
   ```

   On Vercel the SDK authenticates with OIDC automatically; `BLOB_READ_WRITE_TOKEN` is only needed
   when running outside Vercel.

3. Generate three secrets (use a password manager):

   ```bash
   openssl rand -base64 32   # ARTIFACTS_PUBLISH_TOKEN
   openssl rand -base64 24   # ARTIFACTS_VIEW_PASSPHRASE
   openssl rand -base64 48   # ARTIFACTS_COOKIE_SECRET
   ```

4. Add them to the project (dashboard → Settings → Environment Variables, or CLI):

   ```bash
   vercel env add ARTIFACTS_PUBLISH_TOKEN production
   vercel env add ARTIFACTS_VIEW_PASSPHRASE production
   vercel env add ARTIFACTS_COOKIE_SECRET production
   # optional, recommended with a custom domain:
   vercel env add ARTIFACTS_PUBLIC_URL production
   ```

5. Deploy:

   ```bash
   vercel --prod
   ```

6. Open the deployment, enter the passphrase, and you are in the (empty) artifact dashboard.

> Rotating `ARTIFACTS_COOKIE_SECRET` signs out every browser. Rotating
> `ARTIFACTS_VIEW_PASSPHRASE` does **not** invalidate existing sessions; rotate the cookie secret
> too if the passphrase leaks.

## Connect opencode

Copy the plugin into your opencode plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
cp plugin/artifacts.ts ~/.config/opencode/plugins/artifacts.ts
```

Create a private config file (preferred over putting the token in shell history):

```bash
cat > ~/.config/opencode/artifacts.json <<'JSON'
{
  "url": "https://your-project.vercel.app",
  "token": "PASTE_ARTIFACTS_PUBLISH_TOKEN"
}
JSON
chmod 600 ~/.config/opencode/artifacts.json
```

`ARTIFACTS_URL` and `ARTIFACTS_PUBLISH_TOKEN` environment variables also work and take precedence.

Restart opencode. Two tools become available:

| Tool | What it does |
|------|--------------|
| `publish_artifact` | Publishes a file or directory, returns the private URL |
| `delete_artifact` | Deletes an artifact by slug |

Then just ask:

```
publish ./report.html as an artifact
publish ./dist as an artifact titled "Q3 dashboard"
```

The plugin skips `node_modules`, `.git`, `.next`, `.vercel`, and symlinks. It defaults the entry
point to `index.html`, walks directories, base64-encodes binary files, and keeps the upload within
Vercel's request limit.

### Limits

- 4 MB total per artifact (Vercel serverless request body limit) and 200 files.
- For larger builds, publish a smaller output folder (for example `dist/`, not `dist/` plus assets
  you do not need), or add a direct-to-Blob upload flow later.

## Publish manually

```bash
curl -X POST "$ARTIFACTS_URL/api/publish" \
  -H "Authorization: Bearer $ARTIFACTS_PUBLISH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hello",
    "files": [
      { "path": "index.html", "content": "<link rel=stylesheet href=./s.css><h1>Hello</h1>" },
      { "path": "s.css", "content": "h1 { font-family: system-ui }" }
    ]
  }'
```

The response returns `url`, `rawUrl`, `slug`, and file metadata.

## Local development

Use the filesystem backend instead of Vercel Blob:

```bash
ARTIFACTS_LOCAL_DIR=.artifacts-local \
ARTIFACTS_PUBLISH_TOKEN=devtoken \
ARTIFACTS_VIEW_PASSPHRASE=devpass \
ARTIFACTS_COOKIE_SECRET=devsecret \
npm run dev
```

Then `http://localhost:3000` shows the passphrase gate (`devpass`), and the curl example above
works with `http://localhost:3000`.

Checks:

```bash
npm run typecheck
npm run build
```

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `BLOB_READ_WRITE_TOKEN` | Yes outside Vercel | Private Blob store access. On Vercel, OIDC (`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`) is used instead. |
| `ARTIFACTS_PUBLISH_TOKEN` | Yes | Bearer token for the publish/delete API and plugin. |
| `ARTIFACTS_VIEW_PASSPHRASE` | Yes | Shared passphrase for viewers. |
| `ARTIFACTS_COOKIE_SECRET` | Yes | HMAC key for session cookies. Stable across deploys. |
| `ARTIFACTS_PUBLIC_URL` | No | Base URL used in returned links (set with custom domains). |
| `ARTIFACTS_SESSION_TTL_HOURS` | No | Session lifetime, default `168` (7 days). |
| `ARTIFACTS_LOCAL_DIR` | No | Local-only filesystem backend. Never set in production. |

## Security model and limits

What this does:

- Publish requires a bearer token compared in constant time; viewing requires the passphrase.
- Session cookies are HttpOnly, SameSite=Lax, Secure in production, and HMAC-signed with an expiry.
- Artifacts are stored in a **private** Blob store and only streamed after a session check.
- Slugs are unguessable (144 bits), and everything is `noindex` with `robots.txt` disallow.
- The viewer iframe uses `sandbox` **without** `allow-same-origin`, so artifact JavaScript cannot
  read the host's cookies, storage, or DOM. CSP adds `frame-ancestors 'self'` and `nosniff`.
- Login rate limiting and a fixed delay slow down passphrase guessing (in-memory, per instance).
- Delete requires the session cookie or the publish token, plus a same-origin check.

What this does **not** do:

- No per-user accounts: everyone with the passphrase sees every artifact, and signed-in viewers can
  delete artifacts.
- In-memory rate limiting is best-effort across serverless instances; use Vercel Firewall or
  Upstash for hard limits.
- Sessions cannot be revoked individually. Rotate `ARTIFACTS_COOKIE_SECRET` to revoke all.
- Static hosting only. No server-side code from artifacts, no custom response headers per artifact,
  and no range-request streaming.
- Artifacts can still call external services from the browser (the CSP allows network requests), so
  do not publish untrusted content you did not generate.

## Project layout

```
app/
  page.tsx                      passphrase gate + artifact dashboard
  a/[slug]/page.tsx             sandboxed viewer
  api/auth/route.ts             passphrase → signed session cookie
  api/logout/route.ts           clear session
  api/publish/route.ts          bearer-token publish API
  api/artifacts/[slug]/...      authenticated raw file streaming + delete
  robots.ts                     disallow everything
lib/
  auth.ts                       HMAC sessions, constant-time compares, passphrase/token checks
  artifacts.ts                  publish/list/delete domain logic
  store.ts                      Vercel Blob and local filesystem storage backends
  serve.ts                      raw response headers and CSP
  paths.ts, mime.ts, manifest.ts, ratelimit.ts
plugin/
  artifacts.ts                  opencode plugin: publish_artifact + delete_artifact
```
