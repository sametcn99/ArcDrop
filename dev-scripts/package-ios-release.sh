#!/usr/bin/env bash
set -euo pipefail

tag=$1
app=''
while IFS= read -r candidate; do
  id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$candidate/Info.plist" 2>/dev/null || true)
  if [[ "$id" == com.arcdrop.client ]]; then
    app=$candidate
    break
  fi
done < <(find cross-platform/src-tauri/gen/apple -type d -name '*.app' -print)
test -n "$app"
binary=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Info.plist")
test "v$version" = "$tag"
xcrun vtool -show-build "$app/$binary" | rg 'platform IOSSIMULATOR'
lipo -verify_arch arm64 "$app/$binary"
mkdir -p release-assets
ditto -c -k --sequesterRsrc --keepParent "$app" "release-assets/ArcDrop-$tag-ios-simulator-arm64.zip"
