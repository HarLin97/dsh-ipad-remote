import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Gateway, readCookie, sessionClearCookie, sessionSetCookie } from '../src/gateway.js'
import { SESSION_COOKIE, SessionAuthority } from '../src/session.js'

const PREFIX = '/__ipad-remote'

let upstream: Server
let upstreamPort: number
let gateway: Gateway
let auth: SessionAuthority
let seen: Array<{ host?: string; cookie?: string; url?: string; origin?: string }>
/** Release valve so the streaming test can prove the body is not buffered. */
let release: () => void
let releaseGate: Promise<void>

/** A valid session cookie for the gateway under test. */
function validCookie(): string {
  return `${SESSION_COOKIE}=${auth.issue('test', 60_000).cookie}`
}

beforeEach(async () => {
  seen = []
  releaseGate = new Promise<void>((resolve) => { release = resolve })
  upstream = createServer((req, res) => {
    seen.push({ host: req.headers.host, cookie: req.headers.cookie, url: req.url, origin: req.headers.origin })
    if (req.url === '/slow') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('first')
      void releaseGate.then(() => { res.end('second') })
      return
    }
    if (req.url === '/harness-cookie') {
      res.writeHead(200, { 'set-cookie': 'harness=super-secret; Path=/', 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html>harness</html>')
  })
  await new Promise<void>((resolve) => { upstream.listen(0, '127.0.0.1', resolve) })
  upstreamPort = (upstream.address() as AddressInfo).port

  auth = new SessionAuthority(undefined, 8)
  gateway = new Gateway({
    bindHost: '127.0.0.1',
    port: 0,
    target: { host: '127.0.0.1', port: upstreamPort },
    sessions: auth,
    control: {
      prefix: PREFIX,
      handle: (req, res) => {
        if ((req.url ?? '') === `${PREFIX}/unlock`) {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end('<html>unlock</html>')
          return true
        }
        if ((req.url ?? '') === '/manifest.webmanifest') {
          res.writeHead(200, { 'content-type': 'application/manifest+json' })
          res.end('handled-outside-prefix')
          return true
        }
        return false
      },
    },
    upstreamHeaders: () => ({ cookie: 'harness=inner-session' }),
  })
  await gateway.start()
})

afterEach(async () => {
  await gateway.stop()
  await new Promise<void>((resolve) => { upstream.close(() => { resolve() }) })
})

describe('readCookie', () => {
  it('finds a cookie among many and ignores malformed pairs', () => {
    expect(readCookie('a=1; dsh_ipad_session=xyz; b=2', SESSION_COOKIE)).toBe('xyz')
    expect(readCookie('garbage; a=1', SESSION_COOKIE)).toBeUndefined()
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined()
  })
})

describe('cookie serialization', () => {
  it('sets HttpOnly, SameSite and Path', () => {
    const header = sessionSetCookie('v', 60, false)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=60')
    expect(header).not.toContain('Secure')
  })

  it('adds Secure only when asked', () => {
    expect(sessionSetCookie('v', 60, true)).toContain('Secure')
  })

  it('clears with Max-Age=0', () => {
    expect(sessionClearCookie()).toContain('Max-Age=0')
  })
})

describe('authentication gate', () => {
  it('sends an unauthenticated page load to the unlock page', async () => {
    const response = await fetch(`http://127.0.0.1:${String(gateway.port)}/`, {
      redirect: 'manual',
      headers: { accept: 'text/html' },
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${PREFIX}/unlock`)
  })

  it('answers an unauthenticated API call with 401 rather than a redirect', async () => {
    const response = await fetch(`http://127.0.0.1:${String(gateway.port)}/api/sessions`, { redirect: 'manual' })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'ipad-remote/unauthenticated' })
    expect(seen).toHaveLength(0)
  })

  it('does not proxy an unauthenticated request to the upstream', async () => {
    await fetch(`http://127.0.0.1:${String(gateway.port)}/secret`, { redirect: 'manual' })
    expect(seen).toHaveLength(0)
  })

  it('rejects a session cookie signed by another process', async () => {
    const foreign = new SessionAuthority(undefined, 8).issue('attacker', 60_000).cookie
    const response = await fetch(`http://127.0.0.1:${String(gateway.port)}/api/x`, {
      redirect: 'manual',
      headers: { cookie: `${SESSION_COOKIE}=${foreign}` },
    })
    expect(response.status).toBe(401)
  })

  it('consults its control handler for paths outside the prefix', async () => {
    // The enhanced manifest is served from the web-app root, not the device
    // prefix; routing it through the proxy instead was a real bug.
    const response = await fetch(`http://127.0.0.1:${String(gateway.port)}/manifest.webmanifest`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('handled-outside-prefix')
    expect(seen).toHaveLength(0)
  })

  it('serves its own control routes without a session', async () => {
    const response = await fetch(`http://127.0.0.1:${String(gateway.port)}${PREFIX}/unlock`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('unlock')
    expect(seen).toHaveLength(0)
  })
})

describe('HTTP proxying', () => {
  it('forwards an authenticated request and returns the upstream body', async () => {
    const response = await fetch(`http://127.0.0.1:${String(gateway.port)}/`, { headers: { cookie: validCookie() } })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('harness')
  })

  it('rewrites Host and Origin to the loopback authority the Harness fence expects', async () => {
    await fetch(`http://127.0.0.1:${String(gateway.port)}/`, {
      headers: { cookie: validCookie(), origin: `http://127.0.0.1:${String(gateway.port)}` },
    })
    expect(seen[0]?.host).toBe(`127.0.0.1:${String(upstreamPort)}`)
    expect(seen[0]?.origin).toBe(`http://127.0.0.1:${String(upstreamPort)}`)
  })

  it('replaces the browser cookie with the inner Harness cookie', async () => {
    await fetch(`http://127.0.0.1:${String(gateway.port)}/`, { headers: { cookie: validCookie() } })
    expect(seen[0]?.cookie).toBe('harness=inner-session')
    expect(seen[0]?.cookie).not.toContain('dsh_ipad_session')
  })

  it('never lets the Harness Set-Cookie reach the browser', async () => {
    const response = await fetch(`http://127.0.0.1:${String(gateway.port)}/harness-cookie`, {
      headers: { cookie: validCookie() },
    })
    expect(await response.text()).toBe('ok')
    expect(response.headers.getSetCookie()).toEqual([])
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('streams the response instead of buffering it', async () => {
    const response = await fetch(`http://127.0.0.1:${String(gateway.port)}/slow`, { headers: { cookie: validCookie() } })
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    const first = await reader!.read()
    // The upstream has written "first" but not yet ended: if the gateway
    // buffered, this read would still be pending here.
    expect(new TextDecoder().decode(first.value)).toBe('first')
    release()
    const second = await reader!.read()
    expect(new TextDecoder().decode(second.value)).toBe('second')
  })

  it('answers 502 when the upstream is not listening', async () => {
    const dead = new Gateway({
      bindHost: '127.0.0.1',
      port: 0,
      target: { host: '127.0.0.1', port: 1 },
      sessions: auth,
    })
    await dead.start()
    try {
      const response = await fetch(`http://127.0.0.1:${String(dead.port)}/`, { headers: { cookie: validCookie() } })
      expect(response.status).toBe(502)
    } finally {
      await dead.stop()
    }
  })
})

describe('lifecycle', () => {
  it('releases the port so a fresh gateway can bind it', async () => {
    const port = gateway.port
    await gateway.stop()
    const again = new Gateway({
      bindHost: '127.0.0.1', port, target: { host: '127.0.0.1', port: upstreamPort }, sessions: auth,
    })
    await expect(again.start()).resolves.toBe(port)
    await again.stop()
    gateway = new Gateway({ bindHost: '127.0.0.1', port: 0, target: { host: '127.0.0.1', port: upstreamPort }, sessions: auth })
    await gateway.start()
  })

  it('stop() is idempotent', async () => {
    await gateway.stop()
    await expect(gateway.stop()).resolves.toBeUndefined()
    expect(gateway.listening).toBe(false)
  })

  it('reports EADDRINUSE with the address in the message', async () => {
    const clash = new Gateway({
      bindHost: '127.0.0.1', port: gateway.port, target: { host: '127.0.0.1', port: upstreamPort }, sessions: auth,
    })
    await expect(clash.start()).rejects.toThrow(/cannot listen on 127\.0\.0\.1:\d+/)
  })
})
