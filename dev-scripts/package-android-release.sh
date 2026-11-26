#!/usr/bin/env bash
set -euo pipefail

tag=$1
: "${ANDROID_KEYSTORE_B64:?Missing Android release keystore secret}"
: "${ANDROID_KEYSTORE_PASSWORD:?Missing Android keystore password}"
: "${ANDROID_KEY_ALIAS:?Missing Android key alias}"
: "${ANDROID_KEY_PASSWORD:?Missing Android key password}"

export ANDROID_KEYSTORE_FILE="$RUNNER_TEMP/arcdrop-release.p12"
umask 077
printf '%s' "$ANDROID_KEYSTORE_B64" | base64 --decode > "$ANDROID_KEYSTORE_FILE"
unset ANDROID_KEYSTORE_B64

bun --cwd=cross-platform run android:build:release --apk --aab --ci

outputs=cross-platform/src-tauri/gen/android/app/build/outputs
apk="$outputs/apk/universal/release/app-universal-release.apk"
aab="$outputs/bundle/universalRelease/app-universal-release.aab"
test -s "$apk"
test -s "$aab"

build_tools=$(find "$ANDROID_HOME/build-tools" -name apksigner -printf '%h\n' | sort -V | tail -n 1)
test -n "$build_tools"
expected=$(keytool -exportcert -keystore "$ANDROID_KEYSTORE_FILE" -alias "$ANDROID_KEY_ALIAS" \
  -storepass:env ANDROID_KEYSTORE_PASSWORD | sha256sum | cut -d ' ' -f 1)
"$build_tools/apksigner" verify --print-certs "$apk" | tee "$RUNNER_TEMP/arcdrop-apk-signature.txt"
grep -F "certificate SHA-256 digest: $expected" "$RUNNER_TEMP/arcdrop-apk-signature.txt"
"$build_tools/zipalign" -c 4 "$apk"
jarsigner -verify "$aab"
aab_fingerprint=$(keytool -printcert -jarfile "$aab" | awk '/SHA256:/{gsub(":", "", $2); print tolower($2); exit}')
test "$aab_fingerprint" = "$expected"
for abi in arm64-v8a armeabi-v7a x86 x86_64; do
  unzip -Z1 "$apk" | grep -Fx "lib/$abi/libarcdrop_lib.so"
  unzip -Z1 "$aab" | grep -Fx "base/lib/$abi/libarcdrop_lib.so"
done
mkdir -p release-assets
cp "$apk" "release-assets/ArcDrop-$tag-android-universal.apk"
cp "$aab" "release-assets/ArcDrop-$tag-android-universal.aab"
