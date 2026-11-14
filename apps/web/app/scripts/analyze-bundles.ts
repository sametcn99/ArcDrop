// Analyzes Vite dist sourcemaps: which packages land in which chunks.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const distAssets = join(import.meta.dir, '..', 'dist', 'assets');
const files = (await readdir(distAssets)).filter((f) => f.endsWith('.js.map'));

function pkgOf(source) {
  // bun workspaces: node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/...
  // take the LAST node_modules/ segment
  const matches = [...source.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)];
  if (matches.length > 0) return matches[matches.length - 1][1];
  if (source.includes('/src/') || source.startsWith('../src')) return '(app code)';
  return '(other)';
}

const report = [];
for (const f of files) {
  const map = JSON.parse(await Bun.file(join(distAssets, f)).text());
  if (!map.sources) continue;
  const sizes = new Map();
  // approximate per-module share by source content length in sourcesContent
  (map.sources || []).forEach((s, i) => {
    const pkg = pkgOf(s);
    const len = map.sourcesContent?.[i]?.length ?? 0;
    sizes.set(pkg, (sizes.get(pkg) ?? 0) + len);
  });
  const total = [...sizes.values()].reduce((a, b) => a + b, 0) || 1;
  const top = [...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(
      ([pkg, len]) =>
        `${pkg}: ${(len / 1024).toFixed(0)}kB src (${((len / total) * 100).toFixed(0)}%)`,
    );
  report.push({ chunk: f.replace('.js.map', ''), modules: map.sources.length, top });
}

report.sort((a, b) => b.modules - a.modules);
for (const r of report.slice(0, 20)) {
  console.log(`\n=== ${r.chunk} (${r.modules} modules) ===`);
  for (const line of r.top) console.log('  ' + line);
}
