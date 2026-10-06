/**
 * TLS material handling: reading, refusing, and the address-coverage check that
 * tells the operator their certificate no longer matches this machine.
 * The fixture pair is a throwaway self-signed certificate for localhost,
 * committed so the suite needs no openssl and no network.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CERT_FILE, KEY_FILE, coversAddress, loadTls, readCa, tlsDir } from '../src/tls.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/tls-store/', import.meta.url))

/** Path of the store file the fixture material sits beside. */
const STORE = join(FIXTURE, 'config.json')

describe('tlsDir', () => {
  it('sits beside the state file, so one path setting moves both', () => {
    expect(tlsDir('C:/Users/x/.dsh/plugins/ipad-remote/config.json'))
      .toBe(join('C:/Users/x/.dsh/plugins/ipad-remote', 'tls'))
  })
})

describe('loadTls', () => {
  it('reads a usable pair and reports its expiry and SANs', async () => {
    const report = await loadTls(STORE)
    expect(report.error).toBeUndefined()
    expect(report.material?.key.toString('utf8')).toContain('PRIVATE KEY')
    expect(report.material?.cert.toString('utf8')).toContain('CERTIFICATE')
    expect(report.subjectAltName).toContain('localhost')
    expect(Date.parse(String(report.expiresAt))).toBeGreaterThan(Date.now())
  })

  it('reports absence instead of throwing, so plain HTTP keeps serving', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ipad-remote-tls-empty-'))
    const report = await loadTls(join(empty, 'config.json'))
    await rm(empty, { recursive: true, force: true })
    expect(report.material).toBeUndefined()
    expect(report.error).toMatch(/make-tls\.ps1/)
    expect(report.error).toContain('tls')
  })

  it('reports a certificate that is not a certificate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipad-remote-tls-bad-'))
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(dir, 'tls'), { recursive: true })
    await writeFile(join(dir, 'tls', KEY_FILE), 'not a key', 'utf8')
    await writeFile(join(dir, 'tls', CERT_FILE), 'not a certificate', 'utf8')
    const report = await loadTls(join(dir, 'config.json'))
    await rm(dir, { recursive: true, force: true })
    expect(report.material).toBeUndefined()
    expect(report.error).toMatch(/not a usable certificate/)
  })
})

describe('readCa', () => {
  it('returns the CA bytes a device has to install', async () => {
    const ca = await readCa(STORE)
    expect(ca?.toString('utf8')).toBe(await readFile(join(FIXTURE, 'tls', 'ca.crt.pem'), 'utf8'))
  })

  it('returns nothing when there is no CA', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ipad-remote-ca-empty-'))
    expect(await readCa(join(empty, 'config.json'))).toBeUndefined()
    await rm(empty, { recursive: true, force: true })
  })
})

describe('coversAddress', () => {
  it('accepts the shapes Node reports for an IP SAN', () => {
    expect(coversAddress('DNS:localhost, IP Address:192.0.2.10', '192.0.2.10')).toBe(true)
    expect(coversAddress('DNS:localhost, IP:192.0.2.10', '192.0.2.10')).toBe(true)
  })

  it('rejects an address the certificate does not carry', () => {
    expect(coversAddress('DNS:localhost, IP Address:192.0.2.10', '192.0.2.11')).toBe(false)
    expect(coversAddress(undefined, '192.0.2.10')).toBe(false)
  })
})
