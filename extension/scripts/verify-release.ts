// Release verification (E6): opens both release zips and asserts the
// package is complete and loadable — manifest at the root, the icon set,
// all three bundles, and the embedded app with its storage bridge.
//   bun --cwd=extension run verify:release

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, '..');
const distDir = path.join(extensionDir, 'dist');

interface Check {
  label: string;
  ok: boolean;
}

function check(label: string, ok: boolean): Check {
  return { label, ok };
}

function decode(bytes: Uint8Array | undefined): string {
  return bytes === undefined ? '' : new TextDecoder().decode(bytes);
}

async function verifyBrowser(browser: string): Promise<Check[]> {
  const zipPath = path.join(distDir, `arcdrop-extension-${browser}.zip`);
  const zipped = unzipSync(new Uint8Array(await readFile(zipPath)));
  const names = Object.keys(zipped);

  const manifest = JSON.parse(decode(zipped['manifest.json'])) as {
    version: string;
    name: string;
    manifest_version: number;
    background?: { service_worker?: string; scripts?: string[] };
    action?: { default_popup?: string };
    icons?: Record<string, string>;
  };
  const pkg = JSON.parse(decode(await readFile(path.join(extensionDir, 'package.json')))) as {
    version: string;
  };

  const entryScript =
    manifest.background?.service_worker ?? manifest.background?.scripts?.[0] ?? '';

  return [
    check(`${browser}: manifest.json at zip root`, 'manifest.json' in zipped),
    check(
      `${browser}: manifest_version 3 + name ArcDrop`,
      manifest.manifest_version === 3 && manifest.name === 'ArcDrop',
    ),
    check(
      `${browser}: version matches package.json (${pkg.version})`,
      manifest.version === pkg.version,
    ),
    check(
      `${browser}: background bundle present`,
      entryScript.length > 0 && names.includes(entryScript),
    ),
    check(
      `${browser}: popup bundle present`,
      !!manifest.action?.default_popup && names.includes(manifest.action.default_popup),
    ),
    check(`${browser}: options page present`, names.includes('options/index.html')),
    check(
      `${browser}: icon set (16/32/48/128)`,
      !!manifest.icons && Object.values(manifest.icons).every((ref) => names.includes(ref)),
    ),
    check(
      `${browser}: embedded app page + bridge`,
      names.includes('pages/app/index.html') && names.includes('pages/app/bootstrap.js'),
    ),
    check(
      `${browser}: embedded app assets present`,
      names.some((name) => name.startsWith('pages/app/assets/')),
    ),
    check(`${browser}: no source maps`, !names.some((name) => name.endsWith('.map'))),
  ];
}

async function main(): Promise<void> {
  const browsers = (await readdir(distDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'extension-js' && name !== 'pages');

  let failures = 0;
  for (const browser of browsers) {
    for (const result of await verifyBrowser(browser)) {
      console.log(`${result.ok ? '✓' : '✗'} ${result.label}`);
      if (!result.ok) failures += 1;
    }
  }
  if (failures > 0) {
    console.error(`✗ release verification failed (${failures} check(s))`);
    process.exit(1);
  }
  console.log('✓ release packages verified');
}

void main();
