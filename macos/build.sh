#!/bin/zsh
# Builds build/Storage.app (menu-bar app + window + widget). Needs only the Xcode Command Line Tools and Node.js.
# Usage: macos/build.sh [--install] [--release]
#   --install  copies the app to ~/Applications and opens it
#   --release  also writes dist/Storage-<version>.zip and its .sha256 (what the GitHub release workflow uploads)
# Env: STORAGE_ADMIN_URL bakes your fleet admin server URL into the build (empty = no telemetry endpoint).
set -euo pipefail
cd "$(dirname "$0")"; ROOT="$(cd .. && pwd)"; OUT="$ROOT/build"; APP="$OUT/Storage.app"
VERSION="$(node -p "require('$ROOT/package.json').version")"
FLAGS=" $* "
rm -rf "$APP" "$OUT/icon.iconset"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/server" "$APP/Contents/PlugIns"

echo "• icon"
swiftc -O icon.swift -o "$OUT/icon-gen" && "$OUT/icon-gen" "$ROOT/assets/logo.svg" "$OUT/icon-1024.png"
mkdir -p "$OUT/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$OUT/icon-1024.png" --out "$OUT/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$OUT/icon-1024.png" --out "$OUT/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$OUT/icon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"

echo "• app"
swiftc -O -swift-version 5 -target arm64-apple-macos14.0 App/main.swift -o "$APP/Contents/MacOS/Storage" -framework Cocoa -framework WebKit -framework ServiceManagement
cp Info.plist "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION" "$APP/Contents/Info.plist"
SRV="$APP/Contents/Resources/server"
cp "$ROOT/server.js" "$ROOT/package.json" "$SRV/"; cp -R "$ROOT/public" "$SRV/public"; cp -R "$ROOT/lib" "$SRV/lib"; mkdir -p "$SRV/scripts"; cp "$ROOT/scripts/apply-update.sh" "$SRV/scripts/"
node -e "const c=require('$ROOT/fleet.config.json'); if(process.env.STORAGE_ADMIN_URL) c.adminUrl=process.env.STORAGE_ADMIN_URL; require('fs').writeFileSync('$SRV/fleet.config.json', JSON.stringify(c,null,2))"

echo "• widget"
W="$APP/Contents/PlugIns/StorageWidget.appex"; mkdir -p "$W/Contents/MacOS"
swiftc -parse-as-library -O -swift-version 5 -target arm64-apple-macos14.0 -Xfrontend -application-extension \
  -framework WidgetKit -framework SwiftUI \
  -Xlinker -e -Xlinker _NSExtensionMain \
  Widget/StorageWidget.swift -o "$W/Contents/MacOS/StorageWidget"
cp Widget/Info.plist "$W/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION" "$W/Contents/Info.plist"

echo "• sign (ad-hoc, local use)"
codesign --force --sign - --entitlements Widget/Widget.entitlements "$W"
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "  ok"

if [[ "$FLAGS" == *" --release "* ]]; then
  mkdir -p "$ROOT/dist"; Z="$ROOT/dist/Storage-$VERSION.zip"; rm -f "$Z"
  ditto -c -k --keepParent "$APP" "$Z"; (cd "$ROOT/dist" && shasum -a 256 "Storage-$VERSION.zip" > "Storage-$VERSION.zip.sha256")
  echo "  release: $Z"; cat "$ROOT/dist/Storage-$VERSION.zip.sha256"
fi

if [[ "$FLAGS" == *" --install "* ]]; then
  mkdir -p "$HOME/Applications"; pkill -x Storage 2>/dev/null || true; sleep 1
  rm -rf "$HOME/Applications/Storage.app"; cp -R "$APP" "$HOME/Applications/Storage.app"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$HOME/Applications/Storage.app" || true
  pluginkit -a "$HOME/Applications/Storage.app/Contents/PlugIns/StorageWidget.appex" 2>/dev/null || true
  open "$HOME/Applications/Storage.app"; echo "Installed to ~/Applications/Storage.app"
fi
