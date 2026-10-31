# Distributing Storage as a product (Fleet Admin)

This is for you if you ship Storage to other people and want to know **how many devices use it, which version each runs, who has not updated — and to nudge them**. If you only use Storage yourself you can ignore all of this; a default build never contacts a server.

```
 you push a tag  ──►  GitHub Action builds Storage.app, creates the Release (zip + SHA-256)
                              │
                              └─► POST /api/v1/publish (Bearer token) ──► Fleet Admin (rollout 10%…100%)
 user's Storage.app ──(opt-in)── POST /api/v1/checkin ──► gets {latest, minimum, notices}
        │  banner + Dock badge + macOS notification: "Storage 1.2.0 is available — Restart to update"
        └─ Install: download → SHA-256 → bundle id/version → code signature → swap → relaunch
```

## 1. What is measured (and what is not)
Per opted-in device: hash of a random install id, app version, macOS version, Intel/Apple silicon, first/last seen, check-in count, and which update it was told about. **No IPs, no paths, no file data.** Exact payload and user controls: [PRIVACY.md](../PRIVACY.md). Because the payload is tiny and opt-in, you can state in your own privacy policy that no personal data is collected — still have it reviewed for your jurisdiction.

## 2. Pages in the admin
| Page | What you get |
|---|---|
| Overview | devices, active 24h/7d/30d, % on latest, devices needing an update, 30-day activity chart, version/macOS/chip distribution |
| Devices | every device with status **current / outdated / unsupported / stale**, when it was told about an update, last seen; search, filter, CSV export, delete |
| Releases | publish (or auto-publish from CI), staged **rollout %**, **minimum supported version**, yank/restore, per-release adoption and the list of devices still pending |
| Notices | short messages delivered in-app (banner + macOS notification) to everyone or only to outdated devices, with delivered counts |
| Security | audit log of every admin action, password change, retention purge, privacy summary |

### How "who has not updated" is decided
`current` = on the newest non-yanked release; `outdated` = older; `unsupported` = below the minimum version you set; `stale` = not seen for 30 days (excluded from percentages). On each check-in the server records the first time a device was told about a newer version, so you can see *"told 5 days ago, still on 1.0.0"*.

### Pushing a reminder
Notices → *Publish notice* → audience **Only devices that are behind**. Each device shows it at its next check-in (app start and every ~6 h), plus a Dock badge and one macOS notification. The Overview has a one-click **Notify N devices** shortcut.

## 3. Release flow
1. Bump `version` in `package.json`, update `CHANGELOG.md`, commit.
2. `git tag v1.2.0 && git push --tags`.
3. The *Release* workflow builds, creates the GitHub release (`Storage-1.2.0.zip` + `.sha256`) and — if the repo variable `STORAGE_ADMIN_URL` and secret `FLEET_PUBLISH_TOKEN` are set — publishes it to your admin server at **10 % rollout**.
4. Watch adoption on the Releases page, raise the rollout (10 → 50 → 100), or **Yank** if something is wrong.
Apps built without `STORAGE_ADMIN_URL` fall back to checking GitHub Releases directly.

## 4. Deploying the admin server
- Run behind **HTTPS** (Caddy, nginx, Cloudflare Tunnel, Fly.io, Render…). Example Caddy: `fleet.example.com { reverse_proxy 127.0.0.1:4849 }` with `TRUST_PROXY=1 SECURE_COOKIES=1`.
- Back up the SQLite file (`ADMIN_DB`). Keep `PUBLISH_TOKEN` in your CI secrets only.
- Bake the URL into your builds: repo variable `STORAGE_ADMIN_URL=https://fleet.example.com`.

## 5. Security notes
Implemented: scrypt password hashing, 8-hour sessions in `HttpOnly; SameSite=Strict` cookies, CSRF token + Origin check on every change, login rate limiting, constant-time comparisons, strict CSP/security headers, strict payload validation and size limits, audit log, data retention, one-time setup token, publish only for HTTPS GitHub release assets with a required SHA-256, update installs verified end to end.
**Not implemented yet** (be honest with your users): two-factor login and multiple admin roles; an offline-signed update manifest (today trust = your GitHub release + HTTPS + SHA-256 from your server).

## 6. The part that needs money: signing & notarization
Builds from this repo are **ad-hoc signed**. That is fine on the machine that built them, but for strangers' Macs you need an **Apple Developer ID** ($99/yr): sign with it, notarize with `notarytool`, staple, and then Gatekeeper opens the app without warnings. Until then users must right-click → Open the first time (or run `xattr -dr com.apple.quarantine Storage.app`). The in-app updater strips quarantine itself, but changing the signing identity re-asks macOS permissions (Finder automation). The widget needs the same Developer ID signing to be distributed.
