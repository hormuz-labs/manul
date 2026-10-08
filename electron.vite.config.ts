import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { build } from 'esbuild'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The bundled BrowserSkill extension's preloads (its background page; every tab of Manul's browser). Tabs are
// sandboxed, so each preload must be one self-contained file: built apart from index.cjs so nothing is split out.
function extensionPreloads(): Plugin {
  return {
    name: 'manul-extension-preloads',
    async closeBundle() {
      await build({
        entryPoints: { 'ext-host': resolve('src/preload/ext-host.ts'), 'ext-tab': resolve('src/preload/ext-tab.ts') },
        outdir: resolve('out/preload'), outExtension: { '.js': '.cjs' }, bundle: true, format: 'cjs', platform: 'node', target: 'node22',
        external: ['electron'], logLevel: 'warning',
      })
    },
  }
}

// Hidden source maps for crash reports when the release can upload them to Sentry; the .map files are deleted
// before packaging (release.yml).
const sourcemaps = process.env.SENTRY_AUTH_TOKEN ? 'hidden' as const : false

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Release builds only (see telemetry/README.md); without them a build reports nothing and never asks.
    define: {
      __MANUL_TELEMETRY_URL__: JSON.stringify(process.env.MANUL_TELEMETRY_URL || ''),
      __MANUL_POSTHOG_TOKEN__: JSON.stringify(process.env.MANUL_POSTHOG_TOKEN || ''),
      __MANUL_SENTRY_DSN__: JSON.stringify(process.env.MANUL_SENTRY_DSN || ''),
    },
    build: { sourcemap: sourcemaps },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), extensionPreloads()],
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    build: { sourcemap: sourcemaps },
  },
})
