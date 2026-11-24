#!/usr/bin/env bash
set -euo pipefail

built_app=''
while IFS= read -r app; do
  identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist" 2>/dev/null || true)
  if [[ "$identifier" == 'com.arcdrop.client' ]]; then
    built_app=$app
    break
  fi
done < <(find cross-platform/src-tauri/gen/apple cross-platform/src-tauri/target -type d -name '*.app' -print)
test -n "$built_app"

udid=$(xcrun simctl list devices available -j | bun -e '
  const { devices } = JSON.parse(await Bun.stdin.text());
  const phone = Object.values(devices).reverse().flat().find(device => device.name.startsWith("iPhone"));
  if (!phone) throw new Error("No iPhone simulator is available");
  console.log(phone.udid);
')
xcrun simctl boot "$udid"
trap 'xcrun simctl shutdown "$udid"' EXIT
xcrun simctl bootstatus "$udid" -b
xcrun simctl status_bar "$udid" override --time '9:41' --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState unplugged --batteryLevel 100
xcrun simctl ui "$udid" appearance light
xcrun simctl install "$udid" "$built_app"
xcrun simctl launch "$udid" com.arcdrop.client
bun "$SCREENSHOT_SCRIPT" ios-simulator
