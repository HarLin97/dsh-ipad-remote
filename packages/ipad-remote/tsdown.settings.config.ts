/**
 * Browser-half bundle.
 *
 * The Harness client module system serves this file and the browser executes it
 * through the shell's module loader, which expects one lazy-CJS factory: the
 * script registers a factory and every module body (and its side effects) stays
 * inside it until the shell materializes the plugin. That wrapper format is the
 * one the harness's own (unpublished) clientBundle preset emits, reproduced
 * here the way the reference plugin does.
 */
import { defineConfig } from 'tsdown'

/** The id the loader registers; must be the package name. */
const id = '@harlin97/dsh-ipad-remote'

/** Specifiers the shell seeds into its frozen module table. */
const platformModules = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']

export default defineConfig({
  entry: { settings: 'src/client/settings.tsx' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    // Everything else — including the vendored QR encoder — is inlined, because
    // the browser fetches exactly one script for this plugin.
    neverBundle: platformModules,
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  outputOptions: {
    entryFileNames: 'settings.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
