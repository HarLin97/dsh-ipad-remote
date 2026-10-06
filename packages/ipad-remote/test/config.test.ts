import { describe, expect, it } from 'vitest'
import { DEFAULT_BIND_HOST, resolveConfig, resolveHome } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies every default when config is absent', () => {
    const resolved = resolveConfig(undefined, { DSH_HOME: 'C:\\dsh' })
    expect(resolved.bindHost).toBe(DEFAULT_BIND_HOST)
    expect(resolved.maxSessions).toBe(32)
    expect(resolved.storePath.endsWith('plugins\\ipad-remote\\config.json')
      || resolved.storePath.endsWith('plugins/ipad-remote/config.json')).toBe(true)
  })

  it('accepts loopback as an explicit posture', () => {
    expect(resolveConfig({ bindHost: '127.0.0.1' }, {}).bindHost).toBe('127.0.0.1')
  })

  it('rejects a bind host upstream does not support', () => {
    expect(() => resolveConfig({ bindHost: '192.168.1.5' }, {})).toThrow(/bindHost/)
  })

  it('rejects a non-positive session ceiling', () => {
    expect(() => resolveConfig({ maxSessions: 0 }, {})).toThrow(/maxSessions/)
    expect(() => resolveConfig({ maxSessions: 1.5 }, {})).toThrow(/maxSessions/)
  })

  it('honours an explicit store path over DSH_HOME', () => {
    const resolved = resolveConfig({ storePath: 'D:\\state\\x.json' }, { DSH_HOME: 'C:\\dsh' })
    expect(resolved.storePath).toContain('x.json')
    expect(resolved.storePath).not.toContain('ipad-remote')
  })
})

describe('resolveHome', () => {
  it('prefers DSH_HOME when set and non-empty', () => {
    expect(resolveHome({ DSH_HOME: 'E:\\custom' })).toBe('E:\\custom')
  })

  it('falls back to ~/.dsh otherwise', () => {
    expect(resolveHome({})).toMatch(/[.]dsh$/)
    expect(resolveHome({ DSH_HOME: '' })).toMatch(/[.]dsh$/)
  })
})
