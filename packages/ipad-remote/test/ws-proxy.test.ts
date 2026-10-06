import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocketServer, WebSocket } from 'ws'
import { Gateway } from '../src/gateway.js'
import { SESSION_COOKIE, SessionAuthority } from '../src/session.js'

let upstream: Server
let wss: WebSocketServer
let upstreamPort: number
let gateway: Gateway
let auth: SessionAuthority
let upgrades: Array<{ host?: string; cookie?: string; protocol?: string }>

function validCookie(): string {
  return `${SESSION_COOKIE}=${auth.issue('test', 60_000).cookie}`
}

beforeEach(async () => {
  upgrades = []
  upstream = createServer((_req, res) => { res.writeHead(404); res.end() })
  wss = new WebSocketServer({ noServer: true })
  upstream.on('upgrade', (req, socket, head) => {
    upgrades.push({ host: req.headers.host, cookie: req.headers.cookie, protocol: req.headers['sec-websocket-protocol'] as string | undefined })
    wss.handleUpgrade(req, socket, head, (client) => {
      client.on('message', (data, isBinary) => { client.send(data, { binary: isBinary }) })
    })
  })
  await new Promise<void>((resolve) => { upstream.listen(0, '127.0.0.1', resolve) })
  upstreamPort = (upstream.address() as AddressInfo).port

  auth = new SessionAuthority(undefined, 8)
  gateway = new Gateway({
    bindHost: '127.0.0.1',
    port: 0,
    target: { host: '127.0.0.1', port: upstreamPort },
    sessions: auth,
    upstreamHeaders: () => ({ cookie: 'harness=inner' }),
  })
  await gateway.start()
})

afterEach(async () => {
  await gateway.stop()
  wss.close()
  await new Promise<void>((resolve) => { upstream.close(() => { resolve() }) })
})

/** Drive a raw upgrade and report what the gateway did with it. */
function rawUpgrade(cookie?: string): Promise<{ line: string; body: string }> {
  return new Promise((resolve, reject) => {
    const request = `GET /api HTTP/1.1\r\nHost: 127.0.0.1:${String(gateway.port)}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${cookie === undefined ? '' : `Cookie: ${cookie}\r\n`}\r\n`
    void import('node:net').then(({ connect }) => {
      const socket = connect(gateway.port, '127.0.0.1', () => { socket.write(request) })
      let buffer = ''
      const done = (): void => { socket.destroy(); resolve({ line: buffer.split('\r\n')[0] ?? '', body: buffer }) }
      socket.on('data', (chunk) => { buffer += chunk.toString('utf8'); if (buffer.includes('\r\n\r\n')) done() })
      socket.on('close', () => { resolve({ line: buffer.split('\r\n')[0] ?? '', body: buffer }) })
      socket.on('error', reject)
      setTimeout(() => { socket.destroy(); resolve({ line: buffer.split('\r\n')[0] ?? '', body: buffer }) }, 2000)
    })
  })
}

describe('WebSocket upgrade proxying', () => {
  it('destroys an unauthenticated upgrade and never reaches the upstream', async () => {
    const result = await rawUpgrade()
    expect(result.line).not.toContain('101')
    expect(upgrades).toHaveLength(0)
  })

  it('completes a handshake for an authenticated upgrade', async () => {
    const result = await rawUpgrade(validCookie())
    expect(result.line).toContain('101')
    expect(upgrades).toHaveLength(1)
  })

  it('carries full-duplex text and binary frames end to end', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(gateway.port)}/api`, { headers: { cookie: validCookie() } })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })

    const echoed = new Promise<string>((resolve) => { socket.once('message', (data) => { resolve(data.toString()) }) })
    socket.send('hello')
    expect(await echoed).toBe('hello')

    const binary = new Promise<Buffer>((resolve) => { socket.once('message', (data) => { resolve(data as Buffer) }) })
    socket.send(Buffer.from([1, 2, 3]))
    expect([...await binary]).toEqual([1, 2, 3])

    socket.close()
  })

  it('rewrites Host and injects the inner cookie on the upgrade', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(gateway.port)}/api`, { headers: { cookie: validCookie() } })
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    socket.close()
    expect(upgrades[0]?.host).toBe(`127.0.0.1:${String(upstreamPort)}`)
    expect(upgrades[0]?.cookie).toBe('harness=inner')
  })

  it('propagates a client close so the upstream socket is released', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(gateway.port)}/api`, { headers: { cookie: validCookie() } })
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
    socket.close()
    await closed
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(upgrades).toHaveLength(1)
  })
})
