# macOS app & widget

`macos/build.sh` builds **Storage.app** with just the Xcode Command Line Tools — no Xcode project, no Electron (the app is ~1 MB).

```bash
./macos/build.sh             # -> build/Storage.app
./macos/build.sh --install   # also copies to ~/Applications and opens it
```

Requirements: macOS 14+, Apple Silicon, Node.js on the Mac (the app starts the bundled `server.js` with your `node`).

## What you get
- **Window** – the dashboard in a native `WKWebView` with a transparent title bar. Closing the window keeps the app running in the menu bar; clicking the Dock icon brings it back.
- **Menu-bar item** – free space at a glance, safe-to-clean total, *Open*, *Rescan*, *Open in Browser*, *Launch at Login* (`SMAppService`), *Quit*.
- **Widget** – small and medium sizes (free-space ring, safe-to-clean, open tasks, next task). It reads `http://127.0.0.1:4747/api/widget` every ~15 min and falls back to the last good values.
- App data lives in `~/Library/Application Support/Storage Dashboard` (via `STORAGE_DATA`).

## Adding the widget
Open the app once (this registers the extension), then right-click the desktop → **Edit Widgets…** → search "Storage". On macOS 14+ you can drag it to the desktop or Notification Center.

> The widget is ad-hoc signed ("sign to run locally"). It works on the Mac that built it. Distributing it to other Macs needs an Apple Developer ID and notarisation.

## Permissions
- **Automation → Finder**: the first time you move something to the Trash, macOS asks whether Storage may control Finder. Say yes (otherwise use *Delete permanently*).
- No Full Disk Access is needed. Folders protected by macOS (Mail, Photos library, …) are simply not measured.

## Files
```
macos/
  App/main.swift            window, menu bar, server launcher
  Widget/StorageWidget.swift  WidgetKit extension
  Info.plist, Widget/Info.plist, Widget/Widget.entitlements
  icon.swift                draws the app icon
  build.sh
```
