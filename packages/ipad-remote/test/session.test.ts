import { describe, expect, it } from 'vitest'
import { SessionAuthority } from '../src/session.js'

const TTL = 60_000

describe('SessionAuthority', () => {
  it('issues a cookie that verifies', () => {
    const auth = new SessionAuthority(undefined, 32, () => 1000)
    const { cookie, payload } = auth.issue('iPad', TTL)
    const verified = auth.verify(cookie)
    expect(verified?.sid).toBe(payload.sid)
    expect(verified?.label).toBe('iPad')
  })

  it('rejects a tampered payload', () => {
    const auth = new SessionAuthority(undefined, 32, () => 1000)
    const { cookie } = auth.issue('iPad', TTL)
    const [body, signature] = cookie.split('.')
    const forged = Buffer.from(JSON.stringify({ v: 1, sid: 'x', iat: 0, exp: 9e15, gen: 0, label: 'evil' }), 'utf8').toString('base64url')
    expect(auth.verify(`${forged}.${signature ?? ''}`)).toBeUndefined()
    expect(auth.verify(`${body ?? ''}.AAAA`)).toBeUndefined()
  })

  it('rejects a cookie signed by a different secret', () => {
    const a = new SessionAuthority(undefined, 32, () => 1000)
    const b = new SessionAuthority(undefined, 32, () => 1000)
    expect(b.verify(a.issue('iPad', TTL).cookie)).toBeUndefined()
  })

  it('rejects absent, empty and malformed cookies without throwing', () => {
    const auth = new SessionAuthority(undefined, 32, () => 1000)
    for (const bad of [undefined, '', 'no-dot', '.', 'a.']) {
      expect(auth.verify(bad)).toBeUndefined()
    }
  })

  it('rejects an expired cookie', () => {
    let now = 1000
    const auth = new SessionAuthority(undefined, 32, () => now)
    const { cookie } = auth.issue('iPad', TTL)
    now = 1000 + TTL + 1
    expect(auth.verify(cookie)).toBeUndefined()
  })

  it('invalidates every session on revokeAll', () => {
    const auth = new SessionAuthority(undefined, 32, () => 1000)
    const first = auth.issue('iPad', TTL).cookie
    const second = auth.issue('Phone', TTL).cookie
    auth.revokeAll()
    expect(auth.verify(first)).toBeUndefined()
    expect(auth.verify(second)).toBeUndefined()
    expect(auth.list()).toEqual([])
  })

  it('evicts the oldest session at the ceiling', () => {
    let now = 1000
    const auth = new SessionAuthority(undefined, 2, () => now)
    const first = auth.issue('a', TTL).cookie
    now += 1
    auth.issue('b', TTL)
    now += 1
    auth.issue('c', TTL)
    expect(auth.list()).toHaveLength(2)
    expect(auth.verify(first)).toBeUndefined()
  })

  it('lists only live sessions', () => {
    let now = 1000
    const auth = new SessionAuthority(undefined, 8, () => now)
    auth.issue('a', TTL)
    now += TTL + 1
    expect(auth.list()).toEqual([])
  })
})
