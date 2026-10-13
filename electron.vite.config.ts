import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared'), '@core': resolve(__dirname, 'src/core') };
const mainAlias = { ...sharedAlias, '@editor': resolve(__dirname, 'src/editor') };

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'";

// Strict CSP for production builds. The dev server needs inline scripts for HMR, so it is skipped there.
const productionCsp: Plugin = {
  name: 'animation-studio:csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy }, injectTo: 'head-prepend' }
  ]
};

export default defineConfig({
  main: {
    resolve: { alias: mainAlias },
    build: {
      rollupOptions: { input: { main: resolve(__dirname, 'src/main/main.ts') } }
    }
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { preload: resolve(__dirname, 'src/preload/preload.ts') },
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@editor': resolve(__dirname, 'src/editor') } },
    plugins: [react(), productionCsp],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
});
