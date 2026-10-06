/**
 * The HTTPS listener, end to end: a real TLS handshake against the fixture
 * certificate, over the same gateway the iPad uses.
 *
 * This is the test that matters for "use the PWA on other devices": Android and
 * desktop Chrome only install from a secure origin, so HTTPS is not a nicety
 * there — and the session cookie has to carry Secure over TLS and drop it over
 * plain HTTP, or the browser will refuse the cookie on one of the two.
 */

import { createServer, type Server } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_PREFIX, DEVICE_PREFIX, type RemoteStatus } from '../src/contract.js'
import { RemoteAccess } from '../src/remote-access.js'
import { resolveConfig } from '../src/config.js'

const PIN = '123456'
const FIXTURE = fileURLToPath(new URL('./fixtures/tls-store/tls/', import.meta.url))

let harness: Server
let harnessPort: number
let access: RemoteAccess
let httpPort: number
let httpsPort: number

/** Ask the OS for a port nobody is using, then release it. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => { probe.listen(0, '127.0.0.1', resolve) })
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>(resolve => { probe.close(() => { resolve() }) })
  return port
}

/** One HTTPS request that tolerates the deliberately self-signed fixture. */
function secureFetch(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = httpsRequest({
      host: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: init.method ?? "GET",
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      rejectUnauthorized: false,
    }, res => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
      })
    })
    req.on("error", reject)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}

/** POST JSON to the loopback control surface. */
async function control(path: string, body?: unknown): Promise<Response> {
  return await fetch(`http://127.0.0.1:${String(harnessPort)}${CONTROL_PREFIX}${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    redirect: "manual",
  })
}

beforeEach(async () => {
  harness = createServer((req, res) => {
    if ((req.url ?? "/").startsWith(CONTROL_PREFIX)) {
      void access.handleControl(req, res)
      return
    }
    if ((req.url ?? "").startsWith("/?token=")) {
      res.writeHead(303, { "set-cookie": "dsh_session=inner-cookie; Path=/", location: "./" })
      res.end()
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end("<html>harness app</html>")
  })
  await new Promise<void>(resolve => { harness.listen(0, "127.0.0.1", resolve) })
  harnessPort = (harness.address() as AddressInfo).port

  httpPort = await freePort()
  httpsPort = await freePort()
  while (httpsPort === httpPort) httpsPort = await freePort()

  // The state file decides both ports, so the test never races the machine's
  // real gateway for 50070/50071.
  const dir = await mkdtemp(join(tmpdir(), "ipad-remote-tls-live-"))
  const storePath = join(dir, "config.json")
  const material = join(dir, "tls")
  await mkdir(material, { recursive: true })
  for (const name of ["server.key.pem", "server.crt.pem", "ca.crt.pem"]) {
    await copyFile(join(FIXTURE, name), join(material, name))
  }
  const { writeFile } = await import("node:fs/promises")
  await writeFile(storePath, JSON.stringify({ version: 1, enabled: false, port: httpPort, tlsPort: httpsPort, sessionDays: 30, pinHash: null }), "utf8")

  access = new RemoteAccess({
    webServerPort: () => harnessPort,
    authenticatedUrl: base => `${base}?token=fake-token`,
    log: () => { /* keep the output clean */ },
  }, resolveConfig({ storePath, bindHost: "127.0.0.1" }))
  await control("/pin", { pin: PIN })
  await control("/enable", { enabled: true })
})

afterEach(async () => {
  await access.dispose()
  await new Promise<void>(resolve => { harness.close(() => { resolve() }) })
})

describe('HTTPS listener', () => {
  it('reports the secure listener and points the addresses at it', async () => {
    const status = await (await control("/status")).json() as RemoteStatus
    expect(status.listening).toBe(true)
    expect(status.tls.enabled).toBe(true)
    expect(status.tls.listening).toBe(true)
    expect(status.tls.port).toBe(httpsPort)
    expect(status.tls.error).toBeUndefined()
    for (const entry of status.addresses) expect(entry.url.startsWith("https://")).toBe(true)
  })

  it('serves the unlock page over TLS', async () => {
    const reply = await secureFetch(`https://127.0.0.1:${String(httpsPort)}${DEVICE_PREFIX}/unlock`)
    expect(reply.status).toBe(200)
    expect(reply.body).toContain("解锁")
  })

  it('keeps the plain listener serving, so an installed icon does not break', async () => {
    const reply = await fetch(`http://127.0.0.1:${String(httpPort)}${DEVICE_PREFIX}/unlock`)
    expect(reply.status).toBe(200)
  })

  it('marks the session cookie Secure only when the request arrived over TLS', async () => {
    const form = { "content-type": "application/x-www-form-urlencoded" }
    const secured = await secureFetch(`https://127.0.0.1:${String(httpsPort)}${DEVICE_PREFIX}/unlock`, { method: "POST", headers: form, body: "pin=" + PIN })
    expect(secured.status).toBe(303)
    expect(String(secured.headers["set-cookie"])).toContain("Secure")
    expect(String(secured.headers["set-cookie"])).toContain("HttpOnly")

    const plain = await fetch(`http://127.0.0.1:${String(httpPort)}${DEVICE_PREFIX}/unlock`, { method: "POST", headers: form, body: "pin=" + PIN, redirect: "manual" })
    expect(plain.status).toBe(303)
    expect(String(plain.headers.getSetCookie()[0])).not.toContain("Secure")
  })

  it('serves the local CA without a session, so a device can trust it before it has one', async () => {
    const reply = await fetch(`http://127.0.0.1:${String(httpPort)}${DEVICE_PREFIX}/ca.crt`)
    expect(reply.status).toBe(200)
    expect(reply.headers.get("content-type")).toContain("application/x-x509-ca-cert")
    expect(await reply.text()).toContain("CERTIFICATE")
  })
})
