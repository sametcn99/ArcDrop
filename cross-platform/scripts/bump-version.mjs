// Single-source version bump (plan T6): writes the same version into
// cross-platform/package.json, src-tauri/tauri.conf.json and
// src-tauri/Cargo.toml — the three places the release pipeline reads.
//   bun --cwd=cross-platform run bump -- 0.2.0
// (the `--` separates bun's own flags from script args)
// After bumping, run `cargo update -p arcdrop` once so Cargo.lock follows.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');

const version = process.argv[2]?.trim();
if (!version || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  console.error('Usage: bun run bump -- <X.Y.Z[-suffix]>   e.g. bun run bump -- 0.2.0');
  process.exit(1);
}

const packagePath = path.join(projectDir, 'package.json');
const confPath = path.join(projectDir, 'src-tauri', 'tauri.conf.json');
const cargoPath = path.join(projectDir, 'src-tauri', 'Cargo.toml');

const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
pkg.version = version;
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const conf = JSON.parse(await readFile(confPath, 'utf8'));
conf.version = version;
await writeFile(confPath, `${JSON.stringify(conf, null, 2)}\n`, 'utf8');

// Cargo.toml: bump the [package] version (first `version = "…"` line).
const cargoSource = await readFile(cargoPath, 'utf8');
const versionLineRe = /^version\s*=\s*"[^"]*"/m;
if (!versionLineRe.test(cargoSource)) {
  console.error('Cargo.toml: package version line not found — check manually');
  process.exit(1);
}
await writeFile(cargoPath, cargoSource.replace(versionLineRe, `version = "${version}"`), 'utf8');

console.log(`Version bumped → ${version} (package.json + tauri.conf.json + Cargo.toml)`);
console.log('Follow-up: cd src-tauri && cargo update -p arcdrop  (refresh Cargo.lock)');
