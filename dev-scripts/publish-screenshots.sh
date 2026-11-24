#!/usr/bin/env bash
set -euo pipefail

gallery="$RUNNER_TEMP/arcdrop-gallery"
bun apps/web/app/scripts/screenshots/gallery.ts "$RUNNER_TEMP/arcdrop-screenshots" "$gallery"

worktree="$RUNNER_TEMP/screenshots-publish"
git worktree add --detach "$worktree" "$GITHUB_SHA"
trap 'git worktree remove --force "$worktree"' EXIT
pushd "$worktree"
if git ls-remote --exit-code --heads origin screenshots; then
  git fetch --no-tags origin refs/heads/screenshots
  git switch --detach FETCH_HEAD
else
  result=$?
  if [[ "$result" != 2 ]]; then exit "$result"; fi
  git switch --orphan screenshots
fi

mkdir -p docs/screenshots
rm -rf docs/screenshots/latest
mv "$gallery" docs/screenshots/latest
git add -- docs/screenshots/latest
git -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -m "Update screenshot gallery for ${GITHUB_SHA:0:12}"
git push origin HEAD:refs/heads/screenshots
popd
