// ArcDrop repo-wide ESLint (flat config).
// Kept at the repo root so every workspace picks it up; individual apps may
// extend or override later if their frameworks demand it.
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import path from 'node:path';
import process from 'node:process';
import tseslint from 'typescript-eslint';

const webSrcRel = path
  .relative(process.cwd(), path.join(import.meta.dirname, 'apps/web/app/src'))
  .replaceAll('\\', '/');
const webSrcBase = webSrcRel === '' ? '.' : webSrcRel;
const webSrcGlob = `${webSrcBase}/**/*.{ts,tsx}`;
const webRoutesGlob = `${webSrcBase}/app/routes.tsx`;

const FORBIDDEN_HOST_ELEMENTS = [
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'base',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'map',
  'mark',
  'menu',
  'meta',
  'meter',
  'nav',
  'noscript',
  'object',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'script',
  'search',
  'section',
  'select',
  'slot',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
  'svg',
  'path',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'rect',
  'g',
  'defs',
  'use',
  'text',
].map((element) => ({
  element,
  message:
    'Raw host elements are forbidden in apps/web/app/src; use MUI components instead (see apps/web/app/README.md).',
}));

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // NestJS DI relies on constructor param properties; keep defaults otherwise.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: [webSrcGlob],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: ['useThemeController'],
        },
      ],
      'react/forbid-elements': ['error', { forbid: FORBIDDEN_HOST_ELEMENTS }],
    },
  },
  {
    files: [webRoutesGlob],
    rules: {
      // Route table exports RouteObject[] rather than Fast Refresh components.
      'react-refresh/only-export-components': 'off',
    },
  },
);
