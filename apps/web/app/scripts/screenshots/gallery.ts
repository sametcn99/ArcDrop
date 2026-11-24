import assert from 'node:assert/strict';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { accountPages, guestPages, screenshotNames, targets } from './catalog';

const [artifacts, destination] = process.argv.slice(2);
assert.ok(artifacts && destination, 'Provide the downloaded artifacts dir and the gallery dir');
const commit = process.env['GITHUB_SHA'];
const repository = `${process.env['GITHUB_SERVER_URL']}/${process.env['GITHUB_REPOSITORY']}`;
const run = `${repository}/actions/runs/${process.env['GITHUB_RUN_ID']}`;
assert.match(commit ?? '', /^[0-9a-f]{40}$/);

const registeredRoutes = await Bun.file(
  resolve(import.meta.dir, '../../src/app/routes.tsx'),
).text();
const routes = [...registeredRoutes.matchAll(/\bpath:\s*'([^']+)'/g)].map((match) =>
  match[1].startsWith('/') ? match[1] : `/${match[1]}`,
);
const capturedPaths = [...guestPages, ...accountPages].map(({ path }) => path.split('?')[0]);
for (const route of routes) {
  const pattern =
    route === '/*' ? /^\/unrecognized-/ : new RegExp(`^${route.replace(/:\w+/g, '[^/]+')}$`);
  assert.ok(
    capturedPaths.some((path) => pattern.test(path)),
    `Missing screenshot route: ${route}`,
  );
}

let count = 0;
const gallery = [
  '# ArcDrop screenshots',
  '',
  `[Source commit](${repository}/commit/${commit}) · [Workflow run](${run})`,
  '',
];
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
for (const target of targets) {
  const dir = resolve(artifacts, `arcdrop-screenshots-${target}`);
  const expected = screenshotNames(target).map((name) => `${name}.png`);
  assert.deepEqual(
    (await readdir(dir)).sort(),
    [...expected].sort(),
    `Incomplete captures for ${target}`,
  );

  const targetDir = resolve(destination, target);
  await mkdir(targetDir, { recursive: true });
  const pages = [`# ${target}`, '', '[All platforms](../README.md)', ''];
  for (const name of expected) {
    const file = resolve(dir, name);
    const png = Buffer.from(await Bun.file(file).arrayBuffer());
    assert.ok(png.length > 1024 && png.subarray(0, 8).equals(signature), `Invalid PNG: ${file}`);
    assert.ok(
      png.readUInt32BE(16) >= 300 && png.readUInt32BE(20) >= 200,
      `Invalid PNG dimensions: ${file}`,
    );
    await copyFile(file, resolve(targetDir, name));
    const title = name.replace(/\.png$/, '').replaceAll('-', ' ');
    pages.push(`## ${title}`, '', `![${title}](${name})`, '');
  }
  await Bun.write(resolve(targetDir, 'README.md'), pages.join('\n'));
  gallery.push(`- [${target}](${target}/README.md) (${expected.length} screenshots)`);
  count += expected.length;
}
gallery.push('', `Total: ${count} screenshots, all generated with synthetic fixtures.`, '');
await Bun.write(resolve(destination, 'README.md'), gallery.join('\n'));
console.log(`Validated ${count} screenshots across ${targets.length} targets`);
