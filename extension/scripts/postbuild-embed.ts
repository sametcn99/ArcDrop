// Post-build step for the embedded app page (E3): copies the prepared
// embed/ directory (web app dist + storage-bridge bootstrap, assembled by
// scripts/build-embed.ts) into EVERY built browser's dist/<browser>/pages/
// app/. Copying after `extension build` keeps the embedded app byte-exact
// as Vite built it — Extension.js never processes these files (its HTML
// entry handling would break the code-split chunk layout).

import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, '..');
const embedDir = path.join(extensionDir, 'embed');
const distDir = path.join(extensionDir, 'dist');

async function main(): Promise<void> {
  const browsers = (await readdir(distDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'extension-js'); // Extension.js internal metadata
  if (browsers.length === 0) {
    console.error('No dist/<browser> directories found — run `extension build` first.');
    process.exit(1);
  }
  for (const browser of browsers) {
    const target = path.join(distDir, browser, 'pages', 'app');
    await mkdir(target, { recursive: true });
    await cp(embedDir, target, { recursive: true });
    console.log(`Embed copied → dist/${browser}/pages/app/`);
  }
}

void main();
