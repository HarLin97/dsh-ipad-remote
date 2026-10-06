/**
 * The settings section is only as correct as the control calls it makes, so
 * these tests drive the client against a stub fetch and pin the wire shape:
 * path, method, body, and how a refusal reaches the user.
 */

import { describe, expect, it } from 'vitest'
import { createControlApi, messageOf, type ControlFetch } from '../src/client/api.js'
import { CONTROL_PREFIX, type RemoteStatus } from '../src/contract.js'

/** Minimal status body the host would answer with. */
const STATUS: RemoteStatus = {
  enabled: true,
  listening: true,
  port: 50070,
  bindHost: '0.0.0.0',
  hasPin: true,
  tls: { enabled: false, listening: false, port: 50071, uncoveredAddresses: [] },
  addresses: [],
  sessions: [],
  storePath: 'C:/Users/x/.dsh/plugins/ipad-remote/config.json',
}

/** One recorded call. */
interface Call {
  url: string
  init: { method?: string; headers?: Record<string, string>; body?: string } | undefined
}

/**
 * Build a stub fetch that records calls and replays one response.
 * @param response - status and body to answer with.
 * @param calls - array the calls are appended to.
 * @returns a fetch-shaped stub.
 */
function stubFetch(
  response: { status: number; body: unknown },
  calls: Call[],
): ControlFetch {
  return (url, init) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: () => Promise.resolve(response.body),
    })
  }
}

describe('createControlApi', () => {
  it('reads the status with a plain GET', async () => {
    const calls: Call[] = []
    const api = createControlApi(stubFetch({ status: 200, body: STATUS }, calls))
    await expect(api.status()).resolves.toEqual(STATUS)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(CONTROL_PREFIX + '/status')
    expect(calls[0]?.init).toEqual({})
  })

  it('enables and disables through a JSON POST', async () => {
    const calls: Call[] = []
    const api = createControlApi(stubFetch({ status: 200, body: STATUS }, calls))
    await api.setEnabled(false)
    expect(calls[0]?.url).toBe(CONTROL_PREFIX + '/enable')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ enabled: false }))
  })

  it('sets the PIN and revokes sessions on their own routes', async () => {
    const calls: Call[] = []
    const api = createControlApi(stubFetch({ status: 200, body: STATUS }, calls))
    await api.setPin('123456')
    await api.revoke()
    expect(calls.map(call => call.url)).toEqual([CONTROL_PREFIX + '/pin', CONTROL_PREFIX + '/revoke'])
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ pin: '123456' }))
  })

  it('surfaces the host refusal message instead of the status code', async () => {
    const calls: Call[] = []
    const api = createControlApi(stubFetch({ status: 400, body: { error: 'PIN 必须是 6 位数字' } }, calls))
    await expect(api.setPin('12')).rejects.toThrow('PIN 必须是 6 位数字')
  })

  it('falls back to the HTTP status when the body carries no message', async () => {
    const calls: Call[] = []
    const api = createControlApi(stubFetch({ status: 500, body: undefined }, calls))
    await expect(api.status()).rejects.toThrow('HTTP 500')
  })

  it('honors a custom prefix', async () => {
    const calls: Call[] = []
    const api = createControlApi(stubFetch({ status: 200, body: STATUS }, calls), '/custom')
    await api.status()
    expect(calls[0]?.url).toBe('/custom/status')
  })
})

describe('messageOf', () => {
  it('keeps a real message and stringifies the rest', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('boom')).toBe('boom')
    expect(messageOf(new Error(''))).toBe('Error')
  })
})
