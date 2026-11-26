import assert from 'node:assert/strict';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const [tag, downloaded, destination] = process.argv.slice(2);
assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/);
assert.ok(downloaded && destination, 'Provide the artifact source and release destination');

const prefix = `ArcDrop-${tag}-`;
const updaterAssets = {
  'darwin-aarch64': 'macos-universal.app.tar.gz',
  'darwin-x86_64': 'macos-universal.app.tar.gz',
  'linux-aarch64': 'linux-arm64.AppImage',
  'linux-aarch64-deb': 'linux-arm64.deb',
  'linux-x86_64': 'linux-x64.AppImage',
  'linux-x86_64-deb': 'linux-x64.deb',
  'windows-aarch64': 'windows-arm64-setup.exe',
  'windows-x86_64': 'windows-x64-setup.exe',
  'windows-x86_64-msi': 'windows-x64.msi',
};
const signed = [...new Set(Object.values(updaterAssets))];
const assets = [
  ...signed,
  ...signed.map((name) => `${name}.sig`),
  'macos-universal.dmg',
  'android-universal.apk',
  'android-universal.aab',
  'ios-simulator-arm64.zip',
  'server-linux-x64.tar.gz',
  'server-linux-arm64.tar.gz',
].map((name) => prefix + name);
const extensions = new Map(
  ['chromium', 'firefox'].map((browser) => [
    `arcdrop-extension-${browser}.zip`,
    `${prefix}extension-${browser}.zip`,
  ]),
);
assets.push(...extensions.values());

const files = new Map<string, string>();
for (const entry of await readdir(downloaded, { withFileTypes: true })) {
  assert.ok(entry.isDirectory(), `Unexpected entry in artifact download: ${entry.name}`);
  const directory = join(downloaded, entry.name);
  for (const file of await readdir(directory, { withFileTypes: true })) {
    assert.ok(file.isFile(), `Unexpected artifact entry: ${file.name}`);
    const asset = extensions.get(file.name) ?? file.name;
    assert.ok(!files.has(asset), `Duplicate release asset: ${asset}`);
    files.set(asset, join(directory, file.name));
  }
}
assert.deepEqual([...files.keys()].sort(), assets.sort(), 'Release artifacts are incomplete');
await mkdir(destination, { recursive: true });
for (const [asset, path] of files) {
  const file = Bun.file(path);
  assert.ok(file.size > 0 && file.size < 2 * 1024 ** 3, `Invalid release asset size: ${asset}`);
  await copyFile(path, join(destination, asset));
}

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA } = process.env;
assert.ok(GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_SHA && GITHUB_RUN_ID);
const base = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}`;
const platforms = Object.fromEntries(
  await Promise.all(
    Object.entries(updaterAssets).map(async ([platform, name]) => {
      const asset = prefix + name;
      const signature = (await Bun.file(join(destination, `${asset}.sig`)).text()).trim();
      assert.match(signature, /^[A-Za-z0-9+/]+={0,2}$/, `Invalid updater signature for ${asset}`);
      return [platform, { signature, url: `${base}/releases/download/${tag}/${asset}` }];
    }),
  ),
);
await Bun.write(
  join(destination, 'latest.json'),
  JSON.stringify(
    {
      version: tag.slice(1),
      notes: `ArcDrop ${tag}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  ) + '\n',
);

await Bun.write(
  'release-notes.md',
  `## ArcDrop ${tag}

Run ArcDrop on your own server and connect the web, desktop, Android or browser-extension clients to the same library. This release includes bookmark archiving and file uploads, collection sharing, two-factor authentication, import and export, and library health tools.

| Platform | Download |
| --- | --- |
| Windows | MSI or setup EXE for x64, setup EXE for ARM64 |
| macOS | Universal DMG for Apple silicon and Intel |
| Linux | AppImage or Debian package for x64 and ARM64 |
| Android | Signed universal APK for direct installation, signed AAB for Play Console |
| iOS | Simulator app ZIP for Apple silicon |
| Chromium and Firefox | Separate extension ZIPs |
| Self-hosted web and API | Docker Compose bundle for Linux x64 or ARM64, including PostgreSQL |

Use the all-bundles ZIP to download every package together. Verify downloads with \`SHA256SUMS\`. Desktop updater bundles are signed with ArcDrop's updater key. macOS is ad hoc signed without Apple notarization, and Windows installers have no Authenticode signature. Installing on a physical iPhone requires an Apple-signed build. The Firefox ZIP supports temporary loading and store submission.

[Source revision](${base}/commit/${GITHUB_SHA}) · [Build and verification](${base}/actions/runs/${GITHUB_RUN_ID}) · [Installation guide](${base}/blob/${tag}/cross-platform/RELEASE.md)
`,
);
