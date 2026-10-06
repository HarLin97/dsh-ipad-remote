/**
 * Does the offline shell work, and is it gated?
 *
 * Both answers come from a real browser driving the real artefacts: this script
 * imports the built `renderServiceWorker` and `injectGatewayMarker` and serves
 * them the way the gateway does, so the worker under test is the shipped one.
 *
 * 1. A marked page must register the worker, cache the shell, and turn an offline
 *    reload into an explanation instead of the browser error page.
 * 2. An unmarked page — the desktop origin, same machine, often same cookie jar —
 *    must register nothing at all.
 *
 * Run after `pnpm build`. Env: PROBE_PORT.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { injectGatewayMarker } from '../packages/ipad-remote/lib/gateway.js'
import { enhanceIndexHtml } from '../packages/ipad-remote/lib/pwa.js'
import { renderServiceWorker } from '../packages/ipad-remote/lib/service-worker.js'

const PORT = Number(process.env.PROBE_PORT ?? 50095)
const CDP_PORT = 9337
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
const ICON = 'packages/ipad-remote/assets/icon-192.png'

/** The client bundle the app would load, standing in for the Harness one. */
const APP_JS = 'window.__APP_READY__ = true'

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  if (path === '/__ipad-remote/sw.js') {
    const body = Buffer.from(renderServiceWorker('0.1.0-check'), 'utf8')
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'service-worker-allowed': '/', 'cache-control': 'no-store', 'content-length': String(body.length) })
    res.end(body); return
  }
  if (path === '/__ipad-remote/icons/icon-192.png') {
    const body = readFileSync(ICON)
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(body.length) }); res.end(body); return
  }
  if (path === '/manifest.webmanifest') {
    const body = Buffer.from(JSON.stringify({ name: 'DeepSeek Harness', short_name: 'DSH', start_url: './', scope: './', display: 'standalone', icons: [{ src: '/__ipad-remote/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] }), 'utf8')
    res.writeHead(200, { 'content-type': 'application/manifest+json', 'content-length': String(body.length) }); res.end(body); return
  }
  if (path === '/app.js') {
    const body = Buffer.from(APP_JS, 'utf8')
    res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': String(body.length) }); res.end(body); return
  }
  if (path === '/api/live') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{"live":true}'); return
  }
  // Production order, reproduced: the Harness injects through tapIndex first, then
  // the gateway marks the document on its way out.
  const html = enhanceIndexHtml('<!doctype html><html><head><title>DSH</title><link rel="manifest" href="/manifest.webmanifest"></head><body><div id="root">app</div><script src="/app.js"></script></body></html>')
  const marked = path === '/unmarked' ? html : injectGatewayMarker(html)
  const body = Buffer.from(marked, 'utf8')
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length) })
  res.end(body)
})
await new Promise(resolve => { server.listen(PORT, '127.0.0.1', resolve) })
const BASE = 'http://127.0.0.1:' + String(PORT)

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
    if (page) { await client.send('Page.enable'); await client.send('Runtime.enable'); await client.send('Network.enable') }
    return client
  }
  send(method, params = {}) {
    const id = this.#next++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.#pending.delete(id)) reject(new Error(method + ' timed out')) }, 25_000)
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return result.result?.value
  }
}

const binary = EDGE.find(candidate => existsSync(candidate))
if (binary === undefined) throw new Error('Edge not found')
const profile = mkdtempSync(join(tmpdir(), 'dsh-sw-check-'))
const child = spawn(binary, ['--headless=new', '--remote-debugging-port=' + String(CDP_PORT), '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
const endpoint = 'http://127.0.0.1:' + String(CDP_PORT) + '/json/version'
for (let attempt = 0; attempt < 60; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 500))
  try { await fetch(endpoint); break } catch { /* wait */ }
}
const info = await (await fetch(endpoint)).json()
const browser = await Cdp.connect(info.webSocketDebuggerUrl, false)

async function openPage(url) {
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const list = await (await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/list')).json()
  const page = await Cdp.connect(list.find(entry => entry.id === created.targetId).webSocketDebuggerUrl)
  await page.send('Page.navigate', { url })
  await new Promise(resolve => setTimeout(resolve, 4000))
  return page
}

console.log('=== 带网关标记的页面 ===')
const marked = await openPage(BASE + '/')
console.log('  标记           : ' + String(await marked.evaluate('window.__IPAD_REMOTE_GATEWAY__')))
console.log('  worker 状态    : ' + String(await marked.evaluate("Promise.race([navigator.serviceWorker.ready.then(function () { return 'ready' }), new Promise(function (resolve) { setTimeout(function () { resolve('timeout') }, 8000) })])")))
console.log('  registrations  : ' + String(await marked.evaluate('navigator.serviceWorker.getRegistrations().then(function (list) { return list.length })')))
console.log('  caches         : ' + String(await marked.evaluate('caches.keys().then(function (keys) { return keys.join(", ") })')))
console.log('  已缓存路径     : ' + String(await marked.evaluate('caches.keys().then(function (keys) { return keys.length === 0 ? "" : caches.open(keys[0]).then(function (cache) { return cache.keys() }).then(function (requests) { return requests.map(function (request) { return new URL(request.url).pathname }).join(" ") }) })')))
await marked.send('Page.navigate', { url: BASE + '/app.js' })
await new Promise(resolve => setTimeout(resolve, 2500))
await marked.evaluate('fetch("/api/live").then(function (r) { return r.status })')
console.log('  API 是否被缓存 : ' + String(await marked.evaluate('caches.keys().then(function (keys) { return caches.open(keys[0]).then(function (cache) { return cache.keys() }).then(function (requests) { return requests.some(function (request) { return request.url.indexOf("/api/") >= 0 }) }) })')))

console.log('=== 断网后重载 ===')
await marked.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
await marked.send('Page.navigate', { url: BASE + '/' })
await new Promise(resolve => setTimeout(resolve, 4000))
console.log('  页面标题       : ' + String(await marked.evaluate('document.title')))
console.log('  正文           : ' + String(await marked.evaluate("document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120)")))
console.log('  是回退页吗     : ' + String(await marked.evaluate('document.body.innerText.indexOf("连不上主机") >= 0')))

console.log('=== 不带标记的页面（桌面端本体）===')
const plain = await openPage('http://localhost:' + String(PORT) + '/unmarked')
console.log('  标记           : ' + String(await plain.evaluate('typeof window.__IPAD_REMOTE_GATEWAY__')))
console.log('  registrations  : ' + String(await plain.evaluate('navigator.serviceWorker.getRegistrations().then(function (list) { return list.length })')))

child.kill()
server.close()
