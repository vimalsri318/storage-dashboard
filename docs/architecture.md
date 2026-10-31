# Architecture

```
┌────────────── Storage.app (macOS) ──────────────┐
│ menu-bar item · native window (WKWebView)       │
│ starts / reuses ─────────────┐                  │
│ PlugIns/StorageWidget.appex  │ GET /api/widget  │
└──────────────────────────────┼──────────────────┘
                               ▼
        server.js  (Node, zero dependencies, 127.0.0.1:4747)
   ┌──────────── scanner ────────────┐   ┌──── API ────┐
   │ du -d 4 ~        → tree         │   │ /api/state  │
   │ find build dirs  → suggestions  │   │ /api/dir    │
   │ cache rules      → suggestions  │   │ /api/clean  │
   │ installers/large → suggestions  │   │ /api/task   │
   └─────────────────────────────────┘   │ /api/run …  │
                  ▼                      └─────────────┘
          data/*.json (scan, history, actions, tasks)
                               ▲
                  public/ (index.html, style.css, app.js)
```

## Scanner (`server.js`)
1. **Map** – one `du -k -x -d 4 $HOME` pass; only entries ≥ 20 MB are kept (`tree`). `/Applications` and `/opt` are measured separately.
2. **Dev artifacts** – `find` for `node_modules`, `.next`, `.turbo`, `target` (with `Cargo.toml`), `venv/.venv` (with `pyvenv.cfg`), `Pods` (with `Podfile`)… Each is sized and aged using the project's `package.json` / `.git` mtimes. Idle ≥ 14 days → **safe**, otherwise **review**.
3. **Caches** – a table of known tool caches (npm, pnpm, uv, pip, Homebrew, Gradle, Cargo, Xcode, simulators, …) plus any `~/Library/Caches/*` over 300 MB.
4. **Files** – installers/archives in `~/Downloads` older than the scan, and files > 300 MB in Downloads/Desktop/Documents/Movies/Pictures/Music.

The result is cached in `data/scan.json` and refreshed automatically after 12 h.

## Categories
`categorize()` maps paths to the chart categories (Dev projects, Developer tools, AI tools & models, Claude, Virtual machines, Apps & app data, Caches, Downloads & documents, Applications, Anaconda & Homebrew, macOS & system). *macOS & system* is whatever is left of the disk's used space after everything measurable is attributed.

## Safety
- Server listens on `127.0.0.1` only; the `Host` header is validated (DNS-rebinding guard).
- Every `POST` needs the per-run token embedded in the page.
- `/api/clean` only accepts ids that the scanner produced; paths are re-validated to live inside `$HOME`.
- `/api/trash` (Explorer) refuses the home root, top-level folders, `~/Library` root, Keychains, iCloud, `.ssh`, `.gnupg`, Photos libraries.
- Review items go to the Trash through Finder (so *Put Back* works); safe/regenerable items are deleted directly.
- `/api/run` executes a fixed whitelist of commands (`conda clean --all`, `brew cleanup`, empty Trash) — never user-supplied strings.

## Front-end (`public/`)
Vanilla JS, no build step. All DOM is built with a tiny `h()` helper that uses `textContent` only, because file names are untrusted. Charts (ring, donut, bars, area chart, treemap) are hand-written SVG/HTML.

**No more reload feeling:** `render()` used to rebuild the page *and* replay the entry animation after every click. It now keeps the scroll position, only animates on real navigation, and selecting items only updates the floating action bar.
