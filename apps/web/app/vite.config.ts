import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ARCDROP_EMBED=extension → the ArcDrop browser extension embeds this dist
// verbatim under chrome-extension://…/pages/app/ — assets must use relative
// paths (the regular web build keeps the default absolute base).
export default defineConfig({
  plugins: [react()],
  base: process.env['ARCDROP_EMBED'] === 'extension' ? './' : '/',
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
