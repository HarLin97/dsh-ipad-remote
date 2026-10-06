/**
 * The network-facing gateway.
 *
 * Responsibilities, in order: own its control routes, enforce the PIN-issued
 * session, then reverse-proxy HTTP and WebSocket upgrades to the loopback
 * Harness webserver. Request bodies and responses are streamed, never buffered,
 * because the Harness client multiplexes long-lived streams over `/api`.
 *
 * Two header rewrites are load-bearing and deliberate:
 * - `Host`/`Origin` become the loopback authority so the Harness trust fence
 *   admits the request. That fence is explicitly not an auth layer (see the
 *   design spec §4 F3); the PIN session is what authenticates the client.
 * - The browser's `Cookie` is dropped and replaced by the gateway's own inner
 *   cookie, so the Harness credential never reaches the iPad.
 * @module @harlin97/dsh-ipad-remote/gateway
 */

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createSecureServer, type Server as SecureServer } from 'node:https'
import type { Socket } from 'node:net'
import { GATEWAY_MARKER } from './service-worker.js'
import type { TlsMaterial } from './tls.js'
import { SESSION_COOKIE, type SessionAuthority } from './session.js'
import type { InnerTarget } from './inner-session.js'

/**
 * How long a half-finished request may delay teardown before it is cut, so a
 * peer that never completes one cannot hold the shutdown open.
 */
const STRAGGLER_MS = 2000

/**
 * Either listener flavour. Both expose the same lifecycle surface, which is all
 * this module uses, so HTTPS costs one branch at creation and nothing else.
 */
export type GatewayListener = Server | SecureServer

/** Gateway log sink. */
export type GatewayLog = (level: 'info' | 'warn', message: string) => void

/** Routes the gateway answers itself instead of proxying. */
export interface GatewayControl {
  /** Absolute path prefix this handler owns. */
  prefix: string
  /**
   * Answer one control request.
   * @returns true when the response was written, false to fall through.
   */
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean
}

/** Construction options. */
export interface GatewayOptions {
  /** Listen host — normally `0.0.0.0`. */
  bindHost: string
  /** Listen port; 0 asks the OS for a free one. */
  port: number
  /**
   * Certificate pair. When present the listener speaks HTTPS, which is what
   * Android and desktop Chrome require before they will install the page.
   */
  tls?: TlsMaterial
  /** Loopback Harness webserver to proxy to. */
  target: InnerTarget
  /** Issues and verifies the iPad-facing sessions. */
  sessions: SessionAuthority
  /** Optional self-owned routes (unlock page, control API). */
  control?: GatewayControl
  /** Headers injected into every upstream request; supplies the inner cookie. */
  upstreamHeaders?: () => Promise<Record<string, string>> | Record<string, string>
  /** Log sink; defaults to silence so tests stay quiet. */
  log?: GatewayLog
}

/**
 * Read one cookie from a `Cookie` header.
 * @param header - raw header value.
 * @param name - cookie name to find.
 * @returns the decoded value, or undefined.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return undefined
}

/**
 * Serialize a session cookie for `Set-Cookie`.
 * @param value - cookie value.
 * @param maxAgeSeconds - lifetime.
 * @param secure - whether to add the `Secure` attribute.
 * @returns the header value.
 */
export function sessionSetCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(maxAgeSeconds)}`,
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

/** Clear-cookie header for logout. */
export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/**
 * Mark one proxied document as gateway-served.
 *
 * The client half registers its service worker only when this mark is present, so
 * the desktop window — which shares a machine, and often a cookie jar, with the
 * gateway — never gains a worker that could serve it stale assets.
 * @param html - the document as the Harness rendered it.
 * @returns the document carrying the marker script.
 */
export function injectGatewayMarker(html: string): string {
  const mark = `${GATEWAY_MARKER}=true`
  if (html.includes(mark)) return html
  const tag = `<script>window.${mark}</script>`
  const headEnd = html.search(/<\/head>/i)
  if (headEnd >= 0) return `${html.slice(0, headEnd)}${tag}${html.slice(headEnd)}`
  const bodyEnd = html.search(/<\/body>/i)
  if (bodyEnd >= 0) return `${html.slice(0, bodyEnd)}${tag}${html.slice(bodyEnd)}`
  return `${html}${tag}`
}

/**
 * Reverse proxy in front of the loopback Harness webserver.
 */
export class Gateway {
  private server: GatewayListener | undefined
  private boundPort = 0
  private readonly sockets = new Set<Socket>()

  /**
   * Sockets with a request whose response has not gone out yet. They survive
   * {@link stop} until that answer leaves, because the request that turns
   * remote access off travels on one of them.
   */
  private readonly busy = new Set<Socket>()

  /** Whether {@link stop} has begun; a finished answer releases its socket. */
  private stopping = false

  /**
   * @param options - listen, target and session wiring.
   */
  constructor(private readonly options: GatewayOptions) {}

  /** Actual listening port; 0 before {@link start}. */
  get port(): number {
    return this.boundPort
  }

  /** Whether the listener is up. */
  get listening(): boolean {
    return this.server !== undefined
  }

  /** Transport this listener speaks, for logs and errors. */
  private get scheme(): 'http' | 'https' {
    return this.options.tls === undefined ? 'http' : 'https'
  }

  /**
   * Start listening.
   * @returns the bound port.
   * @throws when the bind fails, naming the address and the reason.
   */
  async start(): Promise<number> {
    if (this.server !== undefined) return this.boundPort
    const { bindHost, port } = this.options
    this.stopping = false
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      const socket = req.socket
      this.track(socket)
      this.busy.add(socket)
      const settle = (): void => { this.busy.delete(socket) }
      res.once('finish', () => {
        settle()
        if (this.stopping) socket.destroy()
      })
      res.once('close', settle)
      void this.onRequest(req, res).catch((error: unknown) => {
        this.log('warn', `request failed: ${(error as Error).message}`)
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end()
      })
    }
    // One listener, one flavour: HTTPS whenever a certificate pair is configured.
    // That is the whole difference — the routing below is transport-agnostic.
    const server: GatewayListener = this.options.tls === undefined
      ? createServer(handler)
      : createSecureServer({ key: this.options.tls.key, cert: this.options.tls.cert }, handler)
    server.on('upgrade', (req, socket, head) => {
      void this.onUpgrade(req, socket as Socket, head).catch((error: unknown) => {
        this.log('warn', `upgrade failed: ${(error as Error).message}`)
        ;(socket as Socket).destroy()
      })
    })
    server.on('clientError', (_error, socket) => { socket.destroy() })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        reject(new Error(`ipad-remote: ${this.scheme} gateway cannot listen on ${bindHost}:${String(port)}: ${error.message}`))
      }
      server.once('error', onError)
      server.listen({ host: bindHost, port }, () => {
        server.off('error', onError)
        resolve()
      })
    })

    this.server = server
    const address = server.address()
    this.boundPort = typeof address === 'object' && address !== null ? address.port : port
    this.log('info', `${this.scheme} listening on ${bindHost}:${String(this.boundPort)}`)
    return this.boundPort
  }

  /**
   * Stop listening and tear down every connection, including upgraded sockets,
   * which `closeAllConnections()` does not cover.
   *
   * A socket that is still answering keeps its answer: the settings card can be
   * reached through the gateway (that is how an iPad sees it), so the response
   * that reports "remote access is off" travels on a socket this method is
   * about to close. Idle and upgraded sockets — every live device tunnel — go
   * immediately; a busy one goes the moment its response has left.
   */
  async stop(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    this.stopping = true
    const closed = new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    server.closeIdleConnections()
    for (const socket of [...this.sockets]) {
      if (!this.busy.has(socket)) socket.destroy()
    }
    // A peer that opened a socket and never finished a request must not hold
    // the shutdown open; after this the old behaviour is the floor.
    const straggler = setTimeout(() => { server.closeAllConnections() }, STRAGGLER_MS)
    straggler.unref()
    await closed
    clearTimeout(straggler)
    this.sockets.clear()
    this.busy.clear()
    this.boundPort = 0
  }

  /** Route one request: control, then auth, then proxy. */
  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const control = this.options.control
    // Consulted for every path, not only those under its prefix: the enhanced
    // manifest lives at the web-app root, outside the device prefix. The
    // handler owns the decision and returns false to fall through to the proxy.
    if (control !== undefined && await control.handle(req, res)) return
    if (this.options.sessions.verify(readCookie(req.headers.cookie, SESSION_COOKIE)) === undefined) {
      this.refuse(req, res)
      return
    }
    await this.forward(req, res)
  }

  /**
   * Answer an unauthenticated request: a document navigation is sent to the
   * unlock page, an API call gets a flat 401 so the client can surface it.
   */
  private refuse(req: IncomingMessage, res: ServerResponse): void {
    const path = req.url ?? '/'
    const acceptsHtml = (req.headers.accept ?? '').includes('text/html')
    if (req.method === 'GET' && !path.startsWith('/api') && acceptsHtml) {
      const prefix = this.options.control?.prefix ?? ''
      res.writeHead(303, { location: `${prefix}/unlock`, 'cache-control': 'no-store' })
      res.end()
      return
    }
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ error: 'ipad-remote/unauthenticated' }))
  }

  /** Stream a request to the upstream webserver and stream the answer back. */
  private async forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { target } = this.options
    const headers = await this.buildUpstreamHeaders(req)
    const upstream = httpRequest({
      host: target.host,
      port: target.port,
      method: req.method,
      path: req.url,
      headers,
    }, (answer) => {
      // Strip the Harness cookie: the browser must never hold it.
      const outbound = { ...answer.headers }
      delete outbound['set-cookie']
      const status = answer.statusCode ?? 502
      if (status !== 200 || !String(outbound['content-type'] ?? '').includes('text/html')) {
        res.writeHead(status, outbound)
        answer.pipe(res)
        return
      }
      // Documents are buffered so the gateway can mark them. Everything else —
      // including the long-lived `/api` streams — keeps streaming.
      const chunks: Buffer[] = []
      answer.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      answer.on('end', () => {
        const body = Buffer.from(injectGatewayMarker(Buffer.concat(chunks).toString('utf8')), 'utf8')
        delete outbound['content-encoding']
        delete outbound['etag']
        delete outbound['transfer-encoding']
        outbound['content-length'] = String(body.length)
        res.writeHead(status, outbound)
        res.end(body)
      })
      answer.on('error', () => { res.destroy() })
    })
    upstream.on('error', (error: Error) => {
      this.log('warn', `upstream request failed: ${error.message}`)
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      }
      res.end('ipad-remote: the Harness webserver did not answer')
    })
    req.pipe(upstream)
  }

  /** Proxy one WebSocket upgrade, preserving the raw handshake. */
  private async onUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    this.track(socket)
    if (this.options.sessions.verify(readCookie(req.headers.cookie, SESSION_COOKIE)) === undefined) {
      socket.destroy()
      return
    }
    const { target } = this.options
    const upstream = httpRequest({
      host: target.host,
      port: target.port,
      method: 'GET',
      path: req.url,
      headers: await this.buildUpstreamHeaders(req),
    })

    upstream.on('upgrade', (answer, upstreamSocket, upstreamHead) => {
      this.track(upstreamSocket)
      const lines = [`HTTP/1.1 ${String(answer.statusCode)} ${answer.statusMessage ?? 'Switching Protocols'}`]
      for (let i = 0; i < answer.rawHeaders.length; i += 2) {
        lines.push(`${answer.rawHeaders[i] ?? ''}: ${answer.rawHeaders[i + 1] ?? ''}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      if (head.length > 0) upstreamSocket.write(head)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      const teardown = (): void => { socket.destroy(); upstreamSocket.destroy() }
      upstreamSocket.on('error', teardown)
      socket.on('error', teardown)
    })

    // A non-upgrade answer (for example an upstream refusal) is passed through.
    upstream.on('response', (answer) => {
      socket.write(`HTTP/1.1 ${String(answer.statusCode)} ${answer.statusMessage ?? ''}\r\n\r\n`)
      answer.resume()
      socket.end()
    })
    upstream.on('error', (error: Error) => {
      this.log('warn', `upstream upgrade failed: ${error.message}`)
      socket.destroy()
    })
    upstream.end()
  }

  /**
   * Build the upstream header set: loopback authority, no browser cookie, and
   * whatever `upstreamHeaders` supplies (the inner Harness cookie).
   *
   * Dropping `cookie` is what keeps the Harness credential on this side of the
   * gateway; rewriting `host`/`origin` is what lets the Harness trust fence
   * admit the request as a loopback one.
   */
  private async buildUpstreamHeaders(req: IncomingMessage): Promise<Record<string, string | string[]>> {
    const { target } = this.options
    const authority = `${target.host}:${String(target.port)}`
    const headers: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      // `accept-encoding` is dropped so documents arrive as identity bytes: the
      // gateway buffers HTML to mark it, and re-compressing would be work for no
      // gain on a LAN.
      if (value === undefined || key === 'cookie' || key === 'host' || key === 'origin') continue
      if (key === 'accept-encoding') continue
      headers[key] = value
    }
    headers['host'] = authority
    if (req.headers.origin !== undefined) headers['origin'] = `http://${authority}`
    const supplier = this.options.upstreamHeaders
    if (supplier !== undefined) Object.assign(headers, await supplier())
    return headers
  }

  private track(socket: Socket): void {
    // A keep-alive socket passes through here once per request; the listener is
    // attached only on first sight or it would pile up.
    if (this.sockets.has(socket)) return
    this.sockets.add(socket)
    socket.on('close', () => { this.sockets.delete(socket) })
  }

  private log(level: 'info' | 'warn', message: string): void {
    this.options.log?.(level, `ipad-remote: ${message}`)
  }
}
