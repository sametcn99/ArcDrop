#!/usr/bin/env bash
set -euo pipefail

apk=$(find cross-platform/src-tauri/gen/android/app/build/outputs/apk -name '*.apk' -print -quit)
test -n "$apk"
adb install -r "$apk"
adb reverse tcp:4174 tcp:4174
adb forward tcp:4445 tcp:4445
adb shell settings put global heads_up_notifications_enabled 0
adb shell input keyevent 82
adb shell am start -W -n com.arcdrop.client/.MainActivity
bun "$SCREENSHOT_SCRIPT" android-emulator
