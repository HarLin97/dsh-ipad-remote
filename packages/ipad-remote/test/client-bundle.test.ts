/**
 * The browser half is loaded by the Harness client module system, which reads
 * this package's manifest and serves the built `./client` bundle. A mismatch
 * between the two — or a bundle that lost its loader wrapper — fails at
 * activation in the running Harness, where nothing else here would catch it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTROL_PREFIX } from '../src/contract.js'

/** This package's manifest. */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  files: string[]
  exports: Record<string, { default?: string }>
  dsh: { bundle: { patch: string }; client?: { platform?: string; inject?: string[] } }
}

/** The built browser bundle. */
const bundleUrl = new URL('../client/settings.js', import.meta.url)

describe('client half manifest', () => {
  it('declares a web client half with its ordering dependencies', () => {
    expect(manifest.dsh.client?.platform).toBe('web')
    expect(manifest.dsh.client?.inject).toEqual([
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-locale',
    ])
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('exports the client bundle under the path the module system reads', () => {
    expect(manifest.exports['./client']?.default).toBe('./client/settings.js')
    expect(manifest.files).toContain('client')
  })
})

describe('built client bundle', () => {
  it('is present (run pnpm build) and wrapped as one lazy-CJS factory', () => {
    expect(existsSync(bundleUrl), 'client/settings.js is missing — run pnpm build').toBe(true)
    // The bundler may lay the wrapper out over several lines; only the tokens matter.
    const source = readFileSync(bundleUrl, 'utf8').replace(/\s+/g, ' ')
    expect(source.startsWith(`window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`)).toBe(true)
    expect(source).toContain('return module.exports; } });')
  })

  it('registers the settings section and reaches the loopback control surface', () => {
    const source = readFileSync(bundleUrl, 'utf8')
    expect(source).toContain('settings.section')
    expect(source).toContain('ipad-remote')
    expect(source).toContain(CONTROL_PREFIX)
    // The section is useless without the addresses' QR encoder inlined.
    expect(source).toContain('getModuleCount')
  })

  it('registers the directory flow and sniffs the desktop bridge', () => {
    // The slot names are what ui-workspace reads to decide whether to offer
    // "add workspace"; the bridge global is what keeps that offer on the desktop.
    const source = readFileSync(bundleUrl, 'utf8')
    expect(source).toContain('sidebar.workspaces.directoryFlow')
    expect(source).toContain('conversation.hero.workspace.directoryFlow')
    expect(source).toContain('__DSH_DIRECTORY_PICKER__')
  })

  it('keeps the shell-provided modules external', () => {
    const source = readFileSync(bundleUrl, 'utf8')
    expect(source).toContain('require("@deepseek-ai/dsh-client-ui-primitives")')
    expect(source).toContain('require("react")')
  })
})
