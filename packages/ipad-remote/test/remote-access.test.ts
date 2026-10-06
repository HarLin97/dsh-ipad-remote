import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_PREFIX, DEVICE_PREFIX, type RemoteStatus } from '../src/contract.js'
import { RemoteAccess } from '../src/remote-access.js'
import { resolveConfig } from '../src/config.js'

const PIN = '123456'

let harness: Server
let harnessPort: number
let access: RemoteAccess
let seen: Array<{ url?: string; host?: string; cookie?: string }>
let disabled = false
let storePath = ''

/** POST JSON to the loopback control surface. */
async function control(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await fetch(`http://127.0.0.1:${String(harnessPort)}${CONTROL_PREFIX}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  })
}

beforeEach(async () => {
  seen = []
  disabled = false
  harness = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith(CONTROL_PREFIX)) {
      void access.handleControl(req, res)
      return
    }
    // Stand in for the Harness token exchange.
    if (url.startsWith('/?token=')) {
      res.writeHead(303, { 'set-cookie': 'dsh_session=inner-cookie; Path=/', location: './' })
      res.end()
      return
    }
    seen.push({ url, host: req.headers.host, cookie: req.headers.cookie })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html>harness app</html>')
  })
  await new Promise<void>(r => { harness.listen(0, '127.0.0.1', r) })
  harnessPort = (harness.address() as AddressInfo).port

  const dir = await mkdtemp(join(tmpdir(), 'ipad-remote-access-'))
  storePath = join(dir, 'config.json')
  access = new RemoteAccess({
    webServerPort: () => harnessPort,
    authenticatedUrl: base => `${base}?token=fake-token`,
    log: () => { /* keep the test output clean */ },
  }, resolveConfig({ storePath, bindHost: '127.0.0.1' }))
})

afterEach(async () => {
  await access.dispose()
  await new Promise<void>(r => { harness.close(() => { r() }) })
})

describe('the current PIN is revealable only in the run that set it', () => {
  it('reports the PIN that this run set', async () => {
    await control('/pin', { pin: PIN })
    const status = await (await control('/status')).json() as RemoteStatus
    expect(status.hasPin).toBe(true)
    expect(status.currentPin).toBe(PIN)
  })

  it('reports hasPin without a value after a restart', async () => {
    await control('/pin', { pin: PIN })
    await access.dispose()
    access = new RemoteAccess({
      webServerPort: () => harnessPort,
      authenticatedUrl: base => `${base}?token=fake-token`,
      log: () => { /* keep the test output clean */ },
    }, resolveConfig({ storePath, bindHost: '127.0.0.1' }))
    const status = await (await control('/status')).json() as RemoteStatus
    expect(status.hasPin).toBe(true)
    expect(status.currentPin).toBeUndefined()
  })
})

describe('RemoteAccess control surface', () => {
  it('starts disabled with no PIN', async () => {
    const status = await (await control('/status')).json() as RemoteStatus
    expect(status.enabled).toBe(false)
    expect(status.listening).toBe(false)
    expect(status.hasPin).toBe(false)
    expect(disabled).toBe(false)
  })

  it('lists reachable addresses with pairing URLs', async () => {
    const status = await (await control('/status')).json() as RemoteStatus
    expect(Array.isArray(status.addresses)).toBe(true)
    for (const entry of status.addresses) {
      expect(entry.url).toBe(`http://${entry.address}:${String(status.port)}/`)
      expect(['lan', 'tailscale']).toContain(entry.transport)
    }
  })

  it('refuses to enable before a PIN exists', async () => {
    const response = await control('/enable', { enabled: true })
    expect(response.status).toBe(400)
    expect((await response.json() as { error: string }).error).toMatch(/PIN/)
  })

  it('rejects a PIN that is not six digits', async () => {
    expect((await control('/pin', { pin: '123' })).status).toBe(400)
  })

  it('rejects an enable body without a boolean', async () => {
    await control('/pin', { pin: PIN })
    expect((await control('/enable', { enabled: 'yes' })).status).toBe(400)
  })

  it('refuses a cross-site mutation', async () => {
    const response = await control('/pin', { pin: PIN }, { origin: 'https://evil.example' })
    expect(response.status).toBe(403)
  })

  it('answers an unknown control route with 404', async () => {
    expect((await control('/nope')).status).toBe(404)
  })
})

describe('RemoteAccess unlock round trip', () => {
  it('serves the unlock page, rejects a wrong PIN, then admits the right one', async () => {
    await control('/pin', { pin: PIN })
    await control('/enable', { enabled: true })
    const status = await (await control('/status')).json() as RemoteStatus
    expect(status.listening).toBe(true)

    const base = `http://127.0.0.1:${String(status.port)}`

    const page = await fetch(`${base}${DEVICE_PREFIX}/unlock`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('解锁')

    const wrong = await fetch(`${base}${DEVICE_PREFIX}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'pin=000000',
      redirect: 'manual',
    })
    expect(wrong.status).toBe(401)
    expect(seen).toHaveLength(0)

    const right = await fetch(`${base}${DEVICE_PREFIX}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `pin=${PIN}`,
      redirect: 'manual',
    })
    expect(right.status).toBe(303)
    expect(right.headers.get('location')).toBe('/')
    const cookie = right.headers.getSetCookie()[0]?.split(';')[0]
    expect(cookie).toContain('dsh_ipad_session=')

    const app = await fetch(`${base}/`, { headers: { cookie: cookie ?? '' } })
    expect(app.status).toBe(200)
    expect(await app.text()).toContain('harness app')
    // The gateway rewrote the authority and injected the inner Harness cookie.
    expect(seen[0]?.host).toBe(`127.0.0.1:${String(harnessPort)}`)
    expect(seen[0]?.cookie).toBe('dsh_session=inner-cookie')
  })

  it('throttles repeated wrong PINs', async () => {
    await control('/pin', { pin: PIN })
    await control('/enable', { enabled: true })
    const status = await (await control('/status')).json() as RemoteStatus
    const base = `http://127.0.0.1:${String(status.port)}`

    let last = 0
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`${base}${DEVICE_PREFIX}/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'pin=000000',
        redirect: 'manual',
      })
      last = response.status
    }
    expect(last).toBe(429)
  })

  it('answers a disable request before the listener goes away', async () => {
    await control('/pin', { pin: PIN })
    await control('/enable', { enabled: true })
    const status = await (await control('/status')).json() as RemoteStatus
    const base = `http://127.0.0.1:${String(status.port)}`

    // Reach the control surface the way the card does when an iPad renders it:
    // through the gateway, on one of the sockets that disabling destroys.
    const unlock = await fetch(`${base}${DEVICE_PREFIX}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `pin=${PIN}`,
      redirect: 'manual',
    })
    const cookie = unlock.headers.getSetCookie()[0]?.split(';')[0] ?? ''

    const response = await fetch(`${base}${CONTROL_PREFIX}/enable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ enabled: false }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as RemoteStatus
    expect(body.enabled).toBe(false)
    expect(body.listening).toBe(false)

    const after = await (await control('/status')).json() as RemoteStatus
    expect(after.enabled).toBe(false)
    expect(after.listening).toBe(false)
  })

  it('clears the session on logout', async () => {
    await control('/pin', { pin: PIN })
    await control('/enable', { enabled: true })
    const status = await (await control('/status')).json() as RemoteStatus
    const response = await fetch(`http://127.0.0.1:${String(status.port)}${DEVICE_PREFIX}/logout`, {
      method: 'POST',
      redirect: 'manual',
    })
    expect(response.status).toBe(303)
    expect(response.headers.getSetCookie()[0]).toContain('Max-Age=0')
  })
})

describe('RemoteAccess lifecycle', () => {
  it('persists the enabled flag across a fresh instance', async () => {
    await control('/pin', { pin: PIN })
    await control('/enable', { enabled: true })
    const status = await (await control('/status')).json() as RemoteStatus

    // Release the port first: this instance still holds it.
    await access.dispose()

    const second = new RemoteAccess({
      webServerPort: () => harnessPort,
      authenticatedUrl: base => `${base}?token=fake-token`,
      log: () => { /* silent */ },
    }, resolveConfig({ storePath: status.storePath, bindHost: '127.0.0.1' }))
    await second.start()
    expect(second.status().enabled).toBe(true)
    expect(second.status().listening).toBe(true)
    await second.dispose()
  })

  it('surfaces a taken port as enabled-but-not-listening instead of throwing', async () => {
    await control('/pin', { pin: PIN })
    await control('/enable', { enabled: true })
    const status = await (await control('/status')).json() as RemoteStatus

    // A second instance on the same port cannot bind. start() must not reject,
    // because that would abort Harness boot; the card reads the discrepancy.
    const clash = new RemoteAccess({
      webServerPort: () => harnessPort,
      authenticatedUrl: base => `${base}?token=fake-token`,
      log: () => { /* silent */ },
    }, resolveConfig({ storePath: status.storePath, bindHost: '127.0.0.1' }))
    await expect(clash.start()).resolves.toBeUndefined()
    expect(clash.status().enabled).toBe(true)
    expect(clash.status().listening).toBe(false)
    expect(clash.status().port).toBe(status.port)
    await clash.dispose()
  })

  it('revokes sessions and stops listening on disable', async () => {
    await control('/pin', { pin: PIN })
    await control('/enable', { enabled: true })
    const afterRevoke = await (await control('/revoke', {})).json() as RemoteStatus
    expect(afterRevoke.sessions).toEqual([])

    const afterDisable = await (await control('/enable', { enabled: false })).json() as RemoteStatus
    expect(afterDisable.listening).toBe(false)
    expect(afterDisable.enabled).toBe(false)
  })

  it('dispose is idempotent', async () => {
    await access.dispose()
    await expect(access.dispose()).resolves.toBeUndefined()
  })
})
