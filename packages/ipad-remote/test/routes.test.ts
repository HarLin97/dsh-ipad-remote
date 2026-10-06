import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, callerKey, readBody, sameOrigin, sendHtml, sendJson } from '../src/routes.js'

const open: Server[] = []
afterEach(async () => { await Promise.all(open.map(s => new Promise<void>(r => { s.close(() => { r() }) }))) })

/** Serve one request through a handler and report what the client saw. */
async function roundTrip(handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<Response> {
  const server = createServer((req, res) => { handle(req, res) })
  open.push(server)
  await new Promise<void>(r => { server.listen(0, '127.0.0.1', r) })
  const port = (server.address() as AddressInfo).port
  return await fetch(`http://127.0.0.1:${String(port)}/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  })
}

describe('readBody', () => {
  it('parses a JSON body', async () => {
    const response = await roundTrip((req, res) => {
      void readBody(req).then(body => { sendJson(res, 200, body) })
    })
    expect(await response.json()).toEqual({ a: 1 })
  })

  it('parses a form-encoded body', async () => {
    const server = createServer((req, res) => {
      void readBody(req).then(body => { sendJson(res, 200, body) })
    })
    open.push(server)
    await new Promise<void>(r => { server.listen(0, '127.0.0.1', r) })
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'pin=123456',
    })
    expect(await response.json()).toEqual({ pin: '123456' })
  })

  it('treats an empty body as no fields', async () => {
    const server = createServer((req, res) => { void readBody(req).then(b => { sendJson(res, 200, b) }) })
    open.push(server)
    await new Promise<void>(r => { server.listen(0, '127.0.0.1', r) })
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${String(port)}/`, { method: 'POST' })
    expect(await response.json()).toEqual({})
  })

  it('refuses an oversized body', async () => {
    const server = createServer((req, res) => {
      void readBody(req).then(
        () => { sendJson(res, 200, { ok: true }) },
        (error: Error) => { sendJson(res, 413, { error: error.message }) },
      )
    })
    open.push(server)
    await new Promise<void>(r => { server.listen(0, '127.0.0.1', r) })
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(MAX_BODY_BYTES + 10),
    })
    expect(response.status).toBe(413)
    expect((await response.json() as { error: string }).error).toMatch(/too large/)
  })
})

describe('sameOrigin', () => {
  it('allows a matching origin', () => {
    expect(sameOrigin({ headers: { origin: 'http://127.0.0.1:50064', host: '127.0.0.1:50064' } } as never)).toBe(true)
  })

  it('refuses a cross-site origin', () => {
    expect(sameOrigin({ headers: { origin: 'https://evil.example', host: '127.0.0.1:50064' } } as never)).toBe(false)
  })

  it('allows a missing origin (non-browser client) but not a malformed one', () => {
    expect(sameOrigin({ headers: {} } as never)).toBe(true)
    expect(sameOrigin({ headers: { origin: 'not a url', host: '127.0.0.1:50064' } } as never)).toBe(false)
  })

  it('refuses when the host header is absent but an origin is present', () => {
    expect(sameOrigin({ headers: { origin: 'http://127.0.0.1:1' } } as never)).toBe(false)
  })
})

describe('sendHtml / sendJson', () => {
  it('marks responses non-cacheable', async () => {
    const response = await roundTrip((_req, res) => { sendHtml(res, 200, '<p>hi</p>') })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('text/html')
  })
})

describe('callerKey', () => {
  it('falls back to a stable literal when the socket has no address', () => {
    expect(callerKey({ socket: { remoteAddress: undefined } } as never)).toBe('unknown')
  })
})
