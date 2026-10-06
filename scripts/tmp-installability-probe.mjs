/**
 * What does this Chromium require before it offers to install a page?
 *
 * Two pages on the same loopback origin (a secure context by definition), sharing
 * the same manifest shape as the gateway: one with a service worker, one without.
 * Page.getInstallabilityErrors then names the difference, so a missing install
 * button is diagnosed instead of guessed at.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CDP_PORT = 9335
const HTTP_PORT = 5599
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
const ICONS = { 192: 'packages/ipad-remote/assets/icon-192.png', 512: 'packages/ipad-remote/assets/icon-512.png' }

const manifest = scope => JSON.stringify({
  name: 'DeepSeek Harness', short_name: 'DSH', start_url: scope, scope,
  display: 'standalone', theme_color: '#1c1c1e', background_color: '#1c1c1e',
  icons: [192, 512].map(size => ({ src: '/icon-' + String(size) + '.png', sizes: String(size) + 'x' + String(size), type: 'image/png', purpose: 'any' })),
})

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  if (url === '/icon-192.png' || url === '/icon-512.png') {
    const size = url.includes('192') ? 192 : 512
    const body = readFileSync(ICONS[size])
    res.writeHead(200, { 'content-type': 'image/png' }); res.end(body); return
  }
  if (url === '/manifest-a.webmanifest') { res.writeHead(200, { 'content-type': 'application/manifest+json' }); res.end(manifest('/')); return }
  if (url === '/sw/manifest-b.webmanifest') { res.writeHead(200, { 'content-type': 'application/manifest+json' }); res.end(manifest('/sw/')); return }
  if (url === '/sw/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end("self.addEventListener('fetch', () => {})")
    return
  }
  if (url === '/sw/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><link rel="manifest" href="/sw/manifest-b.webmanifest"><title>with sw</title></head><body>b<script>navigator.serviceWorker.register("/sw/sw.js")</script></body></html>')
    return
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><html><head><link rel="manifest" href="/manifest-a.webmanifest"><title>no sw</title></head><body>a</body></html>')
})
await new Promise(resolve => { server.listen(HTTP_PORT, '127.0.0.1', resolve) })

class Cdp {
  #socket
  #next = 1
  #pending = new Map()
  constructor(socket) {
    this.#socket = socket
    socket.addEventListener('message', event => {
      const payload = JSON.parse(String(event.data))
      const waiter = this.#pending.get(payload.id)
      if (waiter === undefined) return
      this.#pending.delete(payload.id)
      if (payload.error !== undefined) waiter.reject(new Error(JSON.stringify(payload.error)))
      else waiter.resolve(payload.result)
    })
  }
  static async connect(url, page = true) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('socket failed')), { once: true })
    })
    const client = new Cdp(socket)
    if (page) { await client.send('Page.enable'); await client.send('Runtime.enable') }
    return client
  }
  send(method, params = {}) {
    const id = this.#next++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.#pending.delete(id)) reject(new Error(method + ' timed out')) }, 20_000)
    })
  }
}

const binary = EDGE.find(candidate => existsSync(candidate))
if (binary === undefined) throw new Error('Edge not found')
const profile = mkdtempSync(join(tmpdir(), 'dsh-install-probe-'))
const child = spawn(binary, ['--headless=new', '--remote-debugging-port=' + String(CDP_PORT), '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
const endpoint = 'http://127.0.0.1:' + String(CDP_PORT) + '/json/version'
for (let attempt = 0; attempt < 60; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 500))
  try { await fetch(endpoint); break } catch { /* wait */ }
}
const info = await (await fetch(endpoint)).json()
const browser = await Cdp.connect(info.webSocketDebuggerUrl, false)

for (const [label, url] of [['no service worker', 'http://127.0.0.1:5599/'], ['with service worker', 'http://127.0.0.1:5599/sw/']]) {
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const list = await (await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/list')).json()
  const page = await Cdp.connect(list.find(entry => entry.id === created.targetId).webSocketDebuggerUrl)
  await page.send('Page.navigate', { url })
  await new Promise(resolve => setTimeout(resolve, 3500))
  const result = await page.send('Page.getInstallabilityErrors')
  const errors = (result.installabilityErrors ?? []).map(entry => entry.errorId + (entry.errorArguments ? ' ' + JSON.stringify(entry.errorArguments) : ''))
  console.log(label.padEnd(22) + ' -> ' + (errors.length === 0 ? 'INSTALLABLE' : JSON.stringify(errors)))
}

child.kill()
server.close()
