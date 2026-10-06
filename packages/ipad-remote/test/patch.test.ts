import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const overlayPath = fileURLToPath(new URL('../../../.run-overlay.yml', import.meta.url))

interface PatchRow { id?: string; name?: string; disabled?: boolean; insert?: PatchRow[] }

/** Read a patch list and flatten its insert entries alongside the top level. */
function flatRows(file: string): PatchRow[] {
  const document = load(readFileSync(file, 'utf8')) as PatchRow[]
  return [...document, ...document.flatMap(row => row.insert ?? [])]
}

describe.each([
  ['packaged patch', patchPath],
  ['dev overlay', overlayPath],
])('%s', (_label, file) => {
  const rows = flatRows(file)

  it('disables the adaptive chooser and ships the backend without a surface', () => {
    // The surface is the plugin client half job now: it occupies the flow slots
    // only on a page that has the Electron bridge, so a browser is never offered
    // "add workspace" while the desktop keeps its own system window. Mounting the
    // upstream browsing surface here would take the desktop window away again.
    const auto = rows.find(row => row.id === 'directory-picker')
    expect(auto?.name).toBe('@deepseek-ai/dsh-host-directory-picker-auto')
    expect(auto?.disabled).toBe(true)
    expect(rows.some(row => row.name === '@deepseek-ai/dsh-host-directory-picker-browse')).toBe(true)
    expect(rows.some(row => row.name === '@deepseek-ai/dsh-client-ui-directory-picker-browse')).toBe(false)
  })
})

describe('dev overlay', () => {
  it('loads the plugin by absolute file URL', () => {
    const plugin = flatRows(overlayPath).find(row => row.id === 'ipad-remote')
    expect(plugin?.name).toMatch(/^file:\/\/\/.*packages\/ipad-remote\/lib\/index\.js$/)
  })
})

describe('packaged patch', () => {
  it('mounts this plugin by package name', () => {
    const plugin = flatRows(patchPath).find(row => row.id === 'ipad-remote')
    expect(plugin?.name).toBe('@harlin97/dsh-ipad-remote')
  })
})
