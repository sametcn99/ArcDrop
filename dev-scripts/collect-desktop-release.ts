import assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const [tag, platform, target] = process.argv.slice(2);
assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/);
const bundles: Record<string, Record<string, string>> = {
  'linux-x64': { AppImage: 'appimage/*.AppImage', deb: 'deb/*.deb' },
  'linux-arm64': { AppImage: 'appimage/*.AppImage', deb: 'deb/*.deb' },
  'windows-x64': { 'setup.exe': 'nsis/*.exe', msi: 'msi/*.msi' },
  'windows-arm64': { 'setup.exe': 'nsis/*.exe' },
  'macos-universal': { dmg: 'dmg/*.dmg', 'app.tar.gz': 'macos/*.app.tar.gz' },
};
const expected = bundles[platform];
assert.ok(expected && target, 'Provide the release platform and cargo target');

const bundleDir = join('cross-platform', 'src-tauri', 'target', target, 'release', 'bundle');
await mkdir('release-assets', { recursive: true });
for (const [extension, glob] of Object.entries(expected)) {
  const files = await Array.fromAsync(new Bun.Glob(glob).scan({ cwd: bundleDir, absolute: true }));
  assert.equal(files.length, 1, `Expected exactly one ${glob} in ${bundleDir}: ${files}`);
  const separator = extension === 'setup.exe' ? '-' : '.';
  const asset = join('release-assets', `ArcDrop-${tag}-${platform}${separator}${extension}`);
  await copyFile(files[0], asset);

  if (['AppImage', 'setup.exe', 'msi', 'app.tar.gz'].includes(extension)) {
    await copyFile(`${files[0]}.sig`, `${asset}.sig`);
  }
}
