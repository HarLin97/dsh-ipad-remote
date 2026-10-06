import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { classifyIpv4, collectAddresses, pairingUrl } from '../src/addresses.js'

/** Build a table entry the way node:os reports it. */
function entry(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` }
}

describe('classifyIpv4', () => {
  it('classifies Tailscale CGNAT space', () => {
    expect(classifyIpv4('100.64.0.1')).toBe('tailscale')
    expect(classifyIpv4('100.127.255.254')).toBe('tailscale')
  })

  it('does not over-reach the CGNAT boundaries', () => {
    expect(classifyIpv4('100.63.0.1')).toBe('lan')
    expect(classifyIpv4('100.128.0.1')).toBe('lan')
  })

  it('classifies ordinary LAN addresses', () => {
    expect(classifyIpv4('192.0.2.10')).toBe('lan')
    expect(classifyIpv4('192.0.2.11')).toBe('lan')
    expect(classifyIpv4('10.0.0.5')).toBe('lan')
  })

  it('skips loopback, link-local, multicast and malformed input', () => {
    for (const bad of ['127.0.0.1', '169.254.84.120', '224.0.0.1', '255.255.255.255', '0.0.0.0',
      'not-an-ip', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-1', '::1', '']) {
      expect(classifyIpv4(bad), bad).toBe('skip')
    }
  })
})

describe('collectAddresses', () => {
  it('reports this machine the way its interfaces actually look', () => {
    const found = collectAddresses({
      WLAN: [entry('192.0.2.10')],
      'Ethernet': [entry('192.0.2.11')],
      'Local Area Connection* 2': [entry('169.254.84.120')],
      Loopback: [entry('127.0.0.1', true)],
      Tailscale: [entry('100.101.102.103')],
    })
    expect(found.map(f => `${f.transport}:${f.address}`)).toEqual([
      'lan:192.0.2.10',
      'lan:192.0.2.11',
      'tailscale:100.101.102.103',
    ])
  })

  it('ignores an internal flag regardless of the literal', () => {
    expect(collectAddresses({ x: [entry('192.168.1.1', true)] })).toEqual([])
  })

  it('de-duplicates the same literal seen on two interfaces', () => {
    expect(collectAddresses({ a: [entry('10.1.1.1')], b: [entry('10.1.1.1')] })).toHaveLength(1)
  })

  it('tolerates an undefined interface entry', () => {
    expect(collectAddresses({ a: undefined })).toEqual([])
  })

  it('ignores IPv6 entries', () => {
    const v6: NetworkInterfaceInfo = { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: 'fe80::1/64', scopeid: 1 }
    expect(collectAddresses({ a: [v6] })).toEqual([])
  })
})

describe('pairingUrl', () => {
  it('builds a root URL carrying the gateway port and no credential', () => {
    expect(pairingUrl('192.0.2.10', 50070)).toBe('http://192.0.2.10:50070/')
  })
})
