// Generates the extension icon set (16/32/48/128) from the web app's
// favicon.svg — the single visual source of truth. Run via the prebuild
// (`bun run prebuild` → scripts/build-icons.ts) or directly:
//   bun --cwd=extension run generate:icons
// Output: extension/icons/icon{16,32,48,128}.png (gitignored build output;
// the manifest references them and Extension.js copies them into dist).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionDir, '..');
const svgPath = path.join(repoRoot, 'apps', 'web', 'app', 'public', 'favicon.svg');
const iconsDir = path.join(extensionDir, 'icons');

const SIZES = [16, 32, 48, 128] as const;

async function main(): Promise<void> {
  const svg = await readFile(svgPath, 'utf8');
  await mkdir(iconsDir, { recursive: true });

  for (const size of SIZES) {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
      background: 'rgba(0,0,0,0)',
    });
    const png = resvg.render().asPng();
    const outPath = path.join(iconsDir, `icon${size}.png`);
    await writeFile(outPath, png);
    console.log(`icon${size}.png (${png.byteLength} bytes)`);
  }
}

void main();
