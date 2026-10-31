# Storage Fleet Admin

Optional server for people who **distribute Storage to other users**. It answers three questions: *how many devices run it, who is on which version, and who still hasn't updated?* — and lets you nudge them.

```bash
# try it with fake data
ADMIN_DB=admin/data/demo.db node admin/seed-demo.js
ADMIN_DB=admin/data/demo.db node admin/server.js        # http://127.0.0.1:4849  → demo / demo-password-123

# real use
ADMIN_PASSWORD='a-long-passphrase-1' PUBLISH_TOKEN="$(openssl rand -hex 24)" node admin/server.js
```
Requires Node **22.13+** (built-in `node:sqlite`, no npm packages). If you don't set `ADMIN_PASSWORD`, a one-time setup token is printed on first run and the page asks you to create the admin.

| Env | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `4849` / `127.0.0.1` | where it listens |
| `ADMIN_DB` | `admin/data/fleet.db` | SQLite file (back it up) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | – | bootstrap the first admin (≥12 chars) |
| `PUBLISH_TOKEN` | – | bearer token CI uses to publish releases (`POST /api/v1/publish`) |
| `TRUST_PROXY` | off | `1` when behind a TLS-terminating proxy (uses `X-Forwarded-For` for rate limits) |
| `SECURE_COOKIES` | off | `1` to mark the session cookie `Secure` (always on behind HTTPS) |
| `RETENTION_DAYS` | `365` | devices not seen for this long are deleted |

Docker: `docker build -f admin/Dockerfile -t storage-fleet-admin . && docker run -p 4849:4849 -v fleet:/data -e ADMIN_PASSWORD=… -e PUBLISH_TOKEN=… storage-fleet-admin` (untested in CI — put it behind HTTPS).

Full guide: [docs/fleet.md](../docs/fleet.md).
