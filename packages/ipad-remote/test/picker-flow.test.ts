/**
 * The directory flow is registered per PAGE, not per boot: the desktop shell
 * carries the Electron bridge and gets its own system window, while a browser
 * registers nothing so ui-workspace stops offering "add workspace". These tests
 * pin the bridge sniffing that decides which of the two a page is.
 */

import { describe, expect, it } from 'vitest'
import { DIRECTORY_BRIDGE_GLOBAL, desktopBridge } from '../src/client/picker-flow.js'

describe('desktopBridge', () => {
  it('finds the bridge a desktop shell preloads', async () => {
    const bridge = desktopBridge({ [DIRECTORY_BRIDGE_GLOBAL]: { pick: async () => 'C:/work' } })
    expect(bridge).toBeDefined()
    expect(await bridge?.pick()).toBe('C:/work')
  })

  it('is undefined in a browser, which is what removes the workspace entry', () => {
    expect(desktopBridge({})).toBeUndefined()
  })

  it('refuses anything that is not a callable pick', () => {
    expect(desktopBridge({ [DIRECTORY_BRIDGE_GLOBAL]: null })).toBeUndefined()
    expect(desktopBridge({ [DIRECTORY_BRIDGE_GLOBAL]: 'yes' })).toBeUndefined()
    expect(desktopBridge({ [DIRECTORY_BRIDGE_GLOBAL]: {} })).toBeUndefined()
    expect(desktopBridge({ [DIRECTORY_BRIDGE_GLOBAL]: { pick: 1 } })).toBeUndefined()
  })
})
