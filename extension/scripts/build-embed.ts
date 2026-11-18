// Pre-build step for the embedded app page (E3).
// 1. Builds the web app with the embed environment: relative asset base
//    (ARCDROP_EMBED=extension) + hash routing (VITE_ROUTER_MODE=hash —
//    extension pages cannot serve history-mode deep paths).
// 2. Copies the built dist into extension/embed/ (a directory name
//    Extension.js does NOT treat as an entry — verified in E3) and adapts
//    index.html: the app's module scripts + stylesheets are stripped from
//    the static HTML and re-injected at runtime by embed/bootstrap.js after
//    the vault is hydrated (the storage bridge). Everything else (fonts,
//    preloads, favicon) is left untouched.
// The regular (non-embed) web build is unaffected — both switches are
// env-conditional in apps/web/app.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionDir, '..');
const webDist = path.join(repoRoot, 'apps', 'web', 'app', 'dist');
const embedDir = path.join(extensionDir, 'embed');

async function buildWebApp(): Promise<void> {
  const result = Bun.spawnSync(['bun', '--cwd=../apps/web/app', 'run', 'build'], {
    cwd: extensionDir,
    env: {
      ...process.env,
      ARCDROP_EMBED: 'extension',
      VITE_ROUTER_MODE: 'hash',
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) {
    process.exit(result.exitCode ?? 1);
  }
}

interface AppRefs {
  scripts: string[];
  styles: string[];
}

/** Strips the app's own script/stylesheet tags; the bridge re-adds them. */
function adaptIndexHtml(html: string): { html: string; refs: AppRefs } {
  const refs: AppRefs = { scripts: [], styles: [] };

  let adapted = html.replace(
    /[ \t]*<script type="module"[^>]*src="(\.{0,2}\/assets\/[^"]+)"[^>]*><\/script>\r?\n?/g,
    (_match, src: string) => {
      refs.scripts.push(src);
      return '';
    },
  );
  adapted = adapted.replace(
    /[ \t]*<link rel="stylesheet" href="(\.{0,2}\/assets\/[^"]+)"[^>]*\/?>\r?\n?/g,
    (_match, href: string) => {
      refs.styles.push(href);
      return '';
    },
  );

  const marker = `<script src="./bootstrap.js" data-arcdrop-app="${JSON.stringify(refs).replaceAll('"', '&quot;')}"></script>\n`;
  adapted = adapted.includes('</body>')
    ? adapted.replace('</body>', `${marker}</body>`)
    : `${adapted}${marker}`;

  return { html: adapted, refs };
}

async function main(): Promise<void> {
  await buildWebApp();

  await rm(embedDir, { recursive: true, force: true });
  await mkdir(embedDir, { recursive: true });
  await cp(webDist, embedDir, { recursive: true });
  await cp(
    path.join(extensionDir, 'embed-src', 'bootstrap.js'),
    path.join(embedDir, 'bootstrap.js'),
  );

  const indexPath = path.join(embedDir, 'index.html');
  const original = await readFile(indexPath, 'utf8');
  const { html, refs } = adaptIndexHtml(original);
  await writeFile(indexPath, html, 'utf8');

  if (refs.scripts.length === 0) {
    console.error('No module scripts found in the built index.html — embed layout changed?');
    process.exit(1);
  }
  console.log(
    `Embed prepared in ${path.relative(repoRoot, embedDir)} ` +
      `(${refs.scripts.length} script(s), ${refs.styles.length} stylesheet(s) deferred to the bridge)`,
  );
}

void main();
