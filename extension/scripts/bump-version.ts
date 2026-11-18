// Single-source version bump: writes the same version into
// extension/package.json AND extension/manifest.json.
//   bun --cwd=extension run bump -- 0.2.0
// (the `--` separates bun's own flags from script args)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, '..');

const version = process.argv[2]?.trim();
if (!version || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  console.error('Usage: bun run bump -- <X.Y.Z[-suffix]>   e.g. bun run bump -- 0.2.0');
  process.exit(1);
}

const packagePath = path.join(extensionDir, 'package.json');
const manifestPath = path.join(extensionDir, 'manifest.json');

const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };
pkg.version = version;
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string };
manifest.version = version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Version bumped → ${version} (package.json + manifest.json)`);
