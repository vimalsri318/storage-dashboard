# Privacy

**By default Storage sends nothing anywhere.** Scanning happens on your Mac; results never leave it.

## Update checks (no account, no identifier)
The app asks GitHub for the latest release of this repository (a normal HTTPS request, so GitHub sees your IP like any website). Nothing about you or your disk is included.

## Optional anonymous check-ins
Only if the build you use has a fleet server configured **and you opt in** (a prompt on first run; change it any time in *Settings → Privacy*). Exactly this is sent, and the app shows it to you verbatim:

```json
{ "v": 1, "installId": "random UUID", "version": "1.0.0", "os": "15.1", "arch": "arm64", "ackNotices": [] }
```
- `installId` is random, generated on your Mac, not derived from hardware, your name or Apple ID. The server stores only a salted hash of it.
- The server does **not** store IP addresses (a salted hash is held in memory for rate-limiting).
- **Never sent:** file or folder names, paths, sizes, counts, usernames, or anything from your disk.
- *Settings → Privacy → Delete my data from the server* removes your record and resets the id.
- Servers purge devices not seen for 365 days by default (configurable).

## Forks and your own builds
This repository ships with **no** telemetry server (`fleet.config.json` → `adminUrl: ""`). A fork can only collect data if its maintainers add a server and users opt in.
