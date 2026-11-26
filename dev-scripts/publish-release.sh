#!/usr/bin/env bash
set -euo pipefail

tag=$1
remote_head=$(git ls-remote --exit-code origin "$GITHUB_REF" | cut -f 1)
test "$remote_head" = "$GITHUB_SHA" || { echo 'Release commit is no longer the default branch tip'; exit 1; }
bun dev-scripts/stage-release.ts "$tag" downloaded-assets release-assets

keyfile="$RUNNER_TEMP/arcdrop-updater.pub"
signature="$RUNNER_TEMP/arcdrop-updater.sig"
jq -r '.plugins.updater.pubkey' cross-platform/src-tauri/tauri.conf.json | base64 --decode > "$keyfile"
(
  cd release-assets
  for file in *.sig; do
    base64 --decode < "$file" > "$signature"
    minisign -V -m "${file%.sig}" -p "$keyfile" -x "$signature"
  done

  # The internal checksum list covers all individual packages. The external list covers the aggregate too.
  sha256sum -- * > "$RUNNER_TEMP/arcdrop-inner-checksums"
  cp "$RUNNER_TEMP/arcdrop-inner-checksums" SHA256SUMS
  archive="ArcDrop-$tag-all-bundles.zip"
  zip -0 -q "$archive" -- *
  mv SHA256SUMS "$RUNNER_TEMP/arcdrop-constituent-checksums"
  cat "$RUNNER_TEMP/arcdrop-constituent-checksums" > SHA256SUMS
  sha256sum -- "$archive" >> SHA256SUMS
  sha256sum --check SHA256SUMS
  unzip -tq "$archive"
  test "$(stat -c '%s' "$archive")" -lt 2147483648
)

if gh release view "$tag" --json isDraft,targetCommitish > "$RUNNER_TEMP/release-state.json" 2>/dev/null; then
  jq --exit-status --arg revision "$GITHUB_SHA" \
    '.isDraft and .targetCommitish == $revision' "$RUNNER_TEMP/release-state.json"
else
  gh release create "$tag" --draft --target "$GITHUB_SHA" --title "ArcDrop $tag" --notes-file release-notes.md
fi
gh release upload "$tag" release-assets/* --clobber
gh release view "$tag" --json assets --jq '.assets[] | select(.state == "uploaded" and .size > 0) | .name' \
  | LC_ALL=C sort > "$RUNNER_TEMP/arcdrop-remote-assets"
find release-assets -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort > "$RUNNER_TEMP/arcdrop-local-assets"
diff -u "$RUNNER_TEMP/arcdrop-local-assets" "$RUNNER_TEMP/arcdrop-remote-assets"
gh release edit "$tag" --draft=false --latest
