#!/usr/bin/env bash
set -euo pipefail

tag=$1
app=cross-platform/src-tauri/gen/apple/build/arm64-sim/ArcDrop.app
id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")
binary=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Info.plist")
test "$id" = com.arcdrop.client
test "v$version" = "$tag"
xcrun vtool -show-build "$app/$binary" | grep -F 'platform IOSSIMULATOR'
lipo "$app/$binary" -verify_arch arm64
mkdir -p release-assets
ditto -c -k --sequesterRsrc --keepParent "$app" "release-assets/ArcDrop-$tag-ios-simulator-arm64.zip"
