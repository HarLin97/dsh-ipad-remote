/**
 * Ask Chromium why (or whether) the gateway page is installable.
 *
 * A manifest and icons are not enough: the browser exposes the install affordance
 * only when its own installability checks pass, and those checks are queryable over
 * the DevTools protocol. This prints Page.getInstallabilityErrors verbatim for both
 * listeners, plus the manifest errors, so the missing requirement is named instead
 * of guessed at.
 *
 * Env: PROBE_PIN (required).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CDP_PORT = 9334
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
const PIN = process.env.PROBE_PIN
if (PIN === undefined) throw new Error('set PROBE_PIN')
const TARGETS = (process.env.PROBE_TARGETS ?? ['http://127.0.0.1:50070', 'https://127.0.0.1:50071', 'http://192.168.50.50:50070', 'https://192.168.50.50:50071'].join(',')).split(',')

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
      setTimeout(() => { if (this.#pending.delete(id)) reject(new Error(method + ' timed out')) }, 30_000)
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return result.result?.value
  }
}

async function ensureBrowser() {
  const endpoint = 'http://127.0.0.1:' + String(CDP_PORT) + '/json/version'
  try { await fetch(endpoint); return null } catch { /* not running */ }
  const binary = EDGE.find(candidate => existsSync(candidate))
  if (binary === undefined) throw new Error('Edge not found')
  const profile = mkdtempSync(join(tmpdir(), 'dsh-install-check-'))
  const child = spawn(binary, ['--headless=new', '--remote-debugging-port=' + String(CDP_PORT), '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--ignore-certificate-errors', 'about:blank'], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500))
    try { await fetch(endpoint); return child } catch { /* wait */ }
  }
  throw new Error('browser never answered')
}

const spawned = await ensureBrowser()
const info = await (await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/version')).json()
const browser = await Cdp.connect(info.webSocketDebuggerUrl, false)

for (const base of TARGETS) {
  console.log('=== ' + base + ' ===')
  let cookie = ''
  try {
    const unlock = await fetch(base + '/__ipad-remote/unlock', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=' + PIN, redirect: 'manual' })
    cookie = (unlock.headers.getSetCookie()[0] ?? '').split(';')[0]
    console.log('  unlock -> ' + String(unlock.status) + (cookie ? ' (session cookie)' : ' (no cookie)'))
  } catch (error) { console.log('  unreachable: ' + String(error.message)); continue }
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const list = await (await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/list')).json()
  const target = list.find(entry => entry.id === created.targetId)
  const page = await Cdp.connect(target.webSocketDebuggerUrl)
  if (cookie) {
    const name = cookie.split('=')[0]
    const value = cookie.slice(name.length + 1)
    await page.send('Network.setCookie', { name, value, url: base + '/', path: '/' })
  }
  await page.send('Page.navigate', { url: base + '/' })
  await new Promise(resolve => setTimeout(resolve, 4000))
  const manifest = await page.send('Page.getAppManifest')
  console.log('  manifest url    : ' + String(manifest.url ?? '(none)'))
  console.log('  manifest errors : ' + (manifest.errors?.length ? JSON.stringify(manifest.errors) : 'none'))
  let parsed = null
  try { parsed = manifest.data ? JSON.parse(manifest.data) : null } catch { parsed = null }
  if (parsed !== null) console.log('  manifest        : display=' + String(parsed.display) + ' icons=' + String((parsed.icons ?? []).length) + ' start_url=' + String(parsed.start_url))
  try {
    const installability = await page.send('Page.getInstallabilityErrors')
    const errors = installability.installabilityErrors ?? []
    console.log('  installability  : ' + (errors.length === 0 ? 'OK (installable)' : JSON.stringify(errors)))
  } catch (error) { console.log('  installability  : query failed -> ' + String(error.message)) }
  const sw = await page.evaluate("navigator.serviceWorker === undefined ? 'no api' : navigator.serviceWorker.getRegistrations().then(list => list.length).catch(e => 'error: ' + e.message)")
  console.log('  service workers : ' + String(sw))
  const context = await page.evaluate("location.protocol + ' secure=' + window.isSecureContext + ' standalone=' + matchMedia('(display-mode: standalone)').matches")
  console.log('  context         : ' + String(context))
}

if (spawned !== null) spawned.kill()
