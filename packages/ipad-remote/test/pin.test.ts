import { describe, expect, it } from 'vitest'
import { PinThrottle, hashPin, isValidPinFormat, verifyPin } from '../src/pin.js'

describe('isValidPinFormat', () => {
  it('accepts exactly six digits', () => {
    expect(isValidPinFormat('123456')).toBe(true)
    expect(isValidPinFormat('000000')).toBe(true)
  })

  it('rejects everything else', () => {
    for (const bad of ['12345', '1234567', '12345a', '', '12 456', '１２３４５６']) {
      expect(isValidPinFormat(bad), bad).toBe(false)
    }
  })
})

describe('hashPin / verifyPin', () => {
  it('verifies the correct PIN', async () => {
    const stored = await hashPin('123456')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(await verifyPin('123456', stored)).toBe(true)
  })

  it('rejects a wrong PIN of the same shape', async () => {
    const stored = await hashPin('123456')
    expect(await verifyPin('246811', stored)).toBe(false)
  })

  it('salts, so the same PIN hashes differently each time', async () => {
    expect(await hashPin('111111')).not.toBe(await hashPin('111111'))
  })

  it('refuses to hash a malformed PIN', async () => {
    await expect(hashPin('12345')).rejects.toThrow(/six|6 digits/)
  })

  it('returns false when no PIN is configured', async () => {
    expect(await verifyPin('123456', null)).toBe(false)
  })

  it('returns false, not a throw, for a malformed verifier', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$1$2$3$AA$BB', 'bcrypt$16384$8$1$AA$BB']) {
      expect(await verifyPin('123456', bad), bad).toBe(false)
    }
  })
})

describe('PinThrottle', () => {
  it('allows attempts until the limit, then backs off', () => {
    const throttle = new PinThrottle(3, 1000)
    for (let i = 0; i < 3; i += 1) {
      expect(throttle.check('a', 0).allowed).toBe(true)
      throttle.recordFailure('a', 0)
    }
    const blocked = throttle.check('a', 0)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('doubles the wait per failure past the limit', () => {
    const throttle = new PinThrottle(1, 1000)
    throttle.recordFailure('a', 0)
    const first = throttle.check('a', 0).retryAfterMs
    throttle.recordFailure('a', 0)
    expect(throttle.check('a', 0).retryAfterMs).toBe(first * 2)
  })

  it('scopes failures per key so one attacker cannot lock out another device', () => {
    const throttle = new PinThrottle(1, 1000)
    throttle.recordFailure('attacker', 0)
    expect(throttle.check('attacker', 0).allowed).toBe(false)
    expect(throttle.check('ipad', 0).allowed).toBe(true)
  })

  it('releases once the window passes and on reset', () => {
    const throttle = new PinThrottle(1, 1000)
    throttle.recordFailure('a', 0)
    expect(throttle.check('a', 5000).allowed).toBe(true)
    throttle.recordFailure('a', 5000)
    throttle.reset('a')
    expect(throttle.check('a', 5000).allowed).toBe(true)
  })
})
