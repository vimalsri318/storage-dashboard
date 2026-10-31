# Storage Dashboard

A local, private dashboard that shows where your Mac's storage goes and suggests what to clean.

**Open it:** double-click `start.command` (or run `node server.js --open`) → http://127.0.0.1:4747
No dependencies, nothing leaves your Mac (the server only listens on 127.0.0.1).

## Pages
- **Overview** – free space ring, where the space goes (by category), biggest folders, alerts when the disk gets full or free space drops fast.
- **Cleanup** – suggestions from the last scan: project build folders (node_modules, .next, .turbo, venvs…), tool caches, old installers, large files, Trash. *Safe* = regenerates by itself. *Review* = your call; those go to the Trash first.
- **Explorer** – treemap + list of any folder; open, show in Finder, move to Trash.
- **History** – free space over time (recorded every 15 min while the app runs) and a log of everything you cleaned.

## Safety
- Only items found by the scanner can be cleaned (by id); the server re-checks every path is inside your home folder.
- Explorer refuses protected places (home root, top-level folders, ~/Library root, Keychains, iCloud, .ssh, Photos libraries…).
- All write requests need a per-run token; requests from other websites are rejected.
- "Move to Trash" goes through Finder, so Put Back works. The first time, macOS may ask to let the app control Finder.

## Notes
- A full scan takes ~2 minutes; results are cached in `data/` and refreshed automatically after 12 h.
- Sizes use macOS units (1 GB = 1,000,000,000 bytes) so they match System Settings.
- Not covered (do by hand): `conda clean --all` (Anaconda pkgs), `brew cleanup` (Homebrew), Docker (`docker system prune`).
