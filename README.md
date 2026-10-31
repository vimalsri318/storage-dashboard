# Storage — a private disk-space dashboard for macOS

See where your Mac's storage goes, and get a short **checklist of small tasks** that actually free space. Runs entirely on your Mac (a local server on `127.0.0.1`), no dependencies, nothing is uploaded.

## Quick start
```bash
./start.command                # or: node server.js --open      -> http://127.0.0.1:4747
./macos/build.sh --install     # optional: native app + menu-bar item + widget
```
A first scan takes about two minutes; results are cached and refreshed after 12 h.

## Pages
- **Overview** – free-space ring, donut chart of where the space goes, today's plan, 7-day trend, what can be reclaimed by type, biggest folders, and alerts when the disk is ≥ 80 % full or free space drops fast.
- **Checklist** – small tasks ordered by payoff: one-click safe cleanups, "your call" reviews, command-only jobs (conda, Homebrew, Trash). See [docs/checklist.md](docs/checklist.md).
- **Cleanup** – every suggestion, grouped, with reason and how to get it back. *Safe* = regenerates by itself; *Review* = your call (goes to the Trash first).
- **Explorer** – treemap and list for any folder; show in Finder or move to Trash.
- **History** – free space over time and a log of everything cleaned.
- **Light / Dark / Auto** theme switch in the sidebar.

## Mac app & widget
`macos/build.sh` produces a ~1 MB `Storage.app` (window + menu-bar item + widget) using only the Command Line Tools. See [docs/mac-app.md](docs/mac-app.md).

## Safety
Local-only server, per-run token, server-side path validation, protected locations, Trash via Finder, fixed command whitelist. Details in [docs/architecture.md](docs/architecture.md).

## Notes
- Sizes use macOS units (1 GB = 1,000,000,000 bytes) so they match System Settings.
- Not automated: Docker (`docker system prune`) — start Docker first.
- Requires Node.js 18.15+ (uses `fs.statfsSync`).
