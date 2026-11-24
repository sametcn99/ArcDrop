// Release packaging (E6): zips BOTH built browsers into store-ready
// archives AFTER the postbuild embed copy, so each zip contains the
// complete extension — manifest, icons, popup/options/background bundles
// AND the embedded app under pages/app/ (Extension.js's own --zip runs
// before the embed copy and would miss it).
//
//   bun --cwd=extension run build:release   (build + embed + this script)
// Output: dist/arcdrop-extension-<browser>.zip (manifest at zip root —
// Chrome Web Store and AMO both require that layout).

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, '..');
const distDir = path.join(extensionDir, 'dist');

const SKIP_SUFFIXES = ['.map'];

async function collectFiles(dir: string, prefix = ''): Promise<Zippable> {
  const files: Zippable = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(files, await collectFiles(path.join(dir, entry.name), relative));
      continue;
    }
    if (SKIP_SUFFIXES.some((suffix) => relative.endsWith(suffix))) {
      continue; // source maps stay out of the store package
    }
    files[relative] = new Uint8Array(await readFile(path.join(dir, entry.name)));
  }
  return files;
}

async function main(): Promise<void> {
  const browsers = (await readdir(distDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'extension-js' && name !== 'pages');

  if (browsers.length === 0) {
    console.error('No dist/<browser> directories found — run `extension build` first.');
    process.exit(1);
  }

  for (const browser of browsers) {
    const browserDir = path.join(distDir, browser);
    // Sanity: the embedded app must have been copied in (postbuild step).
    await stat(path.join(browserDir, 'pages', 'app', 'index.html'));

    const files = await collectFiles(browserDir);
    if (!files['manifest.json']) {
      console.error(`${browser}: manifest.json missing from dist — aborting.`);
      process.exit(1);
    }
    const zipped = zipSync(files, { level: 9 });
    const outPath = path.join(distDir, `arcdrop-extension-${browser}.zip`);
    await writeFile(outPath, zipped);
    console.log(
      `arcdrop-extension-${browser}.zip — ${Object.keys(files).length} files, ` +
        `${(zipped.byteLength / 1024).toFixed(0)} KB`,
    );
  }
}

void main();
