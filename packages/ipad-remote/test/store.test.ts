import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore, DEFAULT_STATE, STORE_VERSION } from '../src/store.js'

let dir: string
let path: string
let store: ConfigStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ipad-remote-store-'))
  path = join(dir, 'config.json')
  store = new ConfigStore(path)
})

afterEach(() => { /* temp dirs are left to the OS; no handle is held */ })

describe('ConfigStore.load', () => {
  it('treats a missing file as a fresh install', async () => {
    expect(await store.load()).toEqual(DEFAULT_STATE)
  })

  it('round-trips saved state', async () => {
    await store.save({ version: STORE_VERSION, enabled: true, port: 50071, tlsPort: 50072, sessionDays: 7, pinHash: 'scrypt$1$2$3$AA$BB' })
    expect(await store.load()).toEqual({ version: STORE_VERSION, enabled: true, port: 50071, tlsPort: 50072, sessionDays: 7, pinHash: 'scrypt$1$2$3$AA$BB' })
  })

  it('refuses corrupt JSON and names the file', async () => {
    await writeFile(path, '{ not json', 'utf8')
    await expect(store.load()).rejects.toThrow(/not usable/)
    expect(await readFile(path, 'utf8')).toBe('{ not json')
  })

  it('refuses an unknown version rather than silently resetting', async () => {
    await writeFile(path, JSON.stringify({ ...DEFAULT_STATE, version: 99 }), 'utf8')
    await expect(store.load()).rejects.toThrow(/unsupported version 99/)
  })

  it('defaults the HTTPS port for a state file written before HTTPS existed', async () => {
    // No tlsPort on disk: an upgrade must keep the PIN and the port, not reject the file.
    await writeFile(path, JSON.stringify({ version: STORE_VERSION, enabled: true, port: 50070, sessionDays: 30, pinHash: 'scrypt$1$2$3$AA$BB' }), 'utf8')
    const state = await store.load()
    expect(state.port).toBe(50070)
    expect(state.tlsPort).toBe(50071)
    expect(state.pinHash).toBe('scrypt$1$2$3$AA$BB')
  })

  it('refuses an out-of-range HTTPS port', async () => {
    await writeFile(path, JSON.stringify({ ...DEFAULT_STATE, tlsPort: 80 }), 'utf8')
    await expect(store.load()).rejects.toThrow(/tlsPort/)
  })

  it('refuses an out-of-range port', async () => {
    await writeFile(path, JSON.stringify({ ...DEFAULT_STATE, port: 80 }), 'utf8')
    await expect(store.load()).rejects.toThrow(/port/)
  })

  it('refuses a non-scalar pinHash', async () => {
    await writeFile(path, JSON.stringify({ ...DEFAULT_STATE, pinHash: 42 }), 'utf8')
    await expect(store.load()).rejects.toThrow(/pinHash/)
  })
})

describe('ConfigStore.save', () => {
  it('leaves no temp file behind', async () => {
    await store.save(DEFAULT_STATE)
    expect(await readdir(dir)).toEqual(['config.json'])
  })

  it('creates missing parent directories', async () => {
    const nested = new ConfigStore(join(dir, 'a', 'b', 'config.json'))
    await nested.save(DEFAULT_STATE)
    expect(await nested.load()).toEqual(DEFAULT_STATE)
  })
})
