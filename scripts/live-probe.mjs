/**
 * Live end-to-end verification against a real Harness instance.
 *
 * Boots are the caller's job; this only probes a running pair:
 *   DSH_HOME=<temp> dsh --patch .run-overlay.yml --profile web --no-open --port 50080
 *   node scripts/live-probe.mjs
 *
 * Env: PROBE_CONTROL (default http://127.0.0.1:50080), PROBE_DEVICE
 * (default http://127.0.0.1:50070), PROBE_PIN (required).
 * Expects a FRESH DSH_HOME for the first-run assertions.
 */
import WebSocket from 'ws'

const CONTROL = (process.env.PROBE_CONTROL ?? 'http://127.0.0.1:50080') + '/ipad-remote/api'
const DEVICE = process.env.PROBE_DEVICE ?? 'http://127.0.0.1:50070'
const PIN = process.env.PROBE_PIN
if (PIN === undefined) throw new Error('set PROBE_PIN to the gateway PIN')
let failures = 0

function check(label, ok, detail = '') {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  -> ' + detail : ''))
  if (!ok) failures += 1
}

async function control(path, body) {
  const response = await fetch(CONTROL + path, body === undefined
    ? {}
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

/** Open a WebSocket and report how it settled. */
function probeSocket(url, headers) {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, headers === undefined ? {} : { headers })
    const done = (outcome) => { try { socket.terminate() } catch { /* already closed */ } resolve(outcome) }
    const timer = setTimeout(() => { done('timeout') }, 8000)
    socket.on('open', () => { clearTimeout(timer); done('open') })
    socket.on('unexpected-response', (_req, res) => { clearTimeout(timer); done('http ' + res.statusCode) })
    socket.on('error', () => { clearTimeout(timer); done('error') })
  })
}

const initial = await control('/status')
check('control /status reachable', initial.status === 200)
check('starts disabled with no PIN', initial.body.enabled === false && initial.body.hasPin === false)
check('enumerates reachable addresses', Array.isArray(initial.body.addresses) && initial.body.addresses.length > 0,
  (initial.body.addresses ?? []).map(a => a.transport + ':' + a.address).join(', '))

check('rejects a malformed PIN', (await control('/pin', { pin: '123' })).status === 400)
check('accepts a six-digit PIN', (await control('/pin', { pin: PIN })).body.hasPin === true)
check('gateway reports listening', (await control('/enable', { enabled: true })).body.listening === true)

const anon = await fetch(DEVICE + '/', { redirect: 'manual', headers: { accept: 'text/html' } })
check('anonymous navigation redirected to unlock',
  anon.status === 303 && anon.headers.get('location') === '/__ipad-remote/unlock', anon.status + ' ' + String(anon.headers.get('location')))
check('anonymous /api answered 401, not a redirect',
  (await fetch(DEVICE + '/api', { redirect: 'manual', method: 'POST' })).status === 401)
check('unlock page served', (await fetch(DEVICE + '/__ipad-remote/unlock')).status === 200)

const wrong = await fetch(DEVICE + '/__ipad-remote/unlock', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=000000', redirect: 'manual',
})
check('wrong PIN rejected', wrong.status === 401)

const right = await fetch(DEVICE + '/__ipad-remote/unlock', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=' + PIN, redirect: 'manual',
})
const setCookie = right.headers.getSetCookie()[0] ?? ''
const cookie = setCookie.split(';')[0]
check('correct PIN issues a session', right.status === 303)
check('session cookie is HttpOnly and SameSite', setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'))

const app = await fetch(DEVICE + '/', { headers: { cookie } })
const html = await app.text()
check('proxied index loads', app.status === 200 && html.includes('id="root"'), 'status=' + app.status + ' bytes=' + html.length)
check('tapIndex reached the real Harness index', html.includes('ipad-remote:pwa'))
check('viewport-fit present in the real index', html.includes('viewport-fit=cover'))
check('apple-touch-icon present', html.includes('apple-touch-icon'))
check('the Harness Set-Cookie never reaches the browser', (app.headers.getSetCookie() ?? []).length === 0)

// --- browser half: the settings section must reach the page ---
// The Harness composes its boot graph into the index, so an entry here is what
// makes the section exist in Settings at all; a plugin that loads host-side but
// is missing from this graph has no UI.
// The web shell injects it as `globalThis["__DSH_BOOT__"] = {...}`.
const bootMatch = html.match(/globalThis\["__DSH_BOOT__"\]\s*=\s*([\s\S]*?)<\/script>/)
let boot = null
try {
  boot = bootMatch === null ? null : JSON.parse(bootMatch[1].trim().replace(/;$/, ''))
} catch {
  boot = null
}
const clientEntry = boot?.entries?.find(entry => entry.id === '@harlin97/dsh-ipad-remote')
check('client half is in the boot graph', clientEntry !== undefined, clientEntry?.url ?? 'no matching __DSH_BOOT__ entry')
if (clientEntry !== undefined) {
  const bundle = await fetch(new URL(clientEntry.url, DEVICE + '/'), { headers: { cookie } })
  const source = await bundle.text()
  check('client bundle served to the page',
    bundle.status === 200 && source.includes('__ModuleLoader__.load'),
    'status=' + bundle.status + ' bytes=' + source.length)
  check('bundle registers the settings section over the control surface',
    source.includes('settings.section') && source.includes('/ipad-remote/api'))
  check('bundle keeps shell-provided modules external',
    source.includes('require("@deepseek-ai/dsh-client-ui-primitives")'))
  check('bundle carries the QR encoder for the address codes', source.includes('getModuleCount'))
}

const manifest = await (await fetch(DEVICE + '/manifest.webmanifest')).json()
check('gateway serves the enhanced manifest', manifest.display === 'standalone', 'display=' + String(manifest.display))
check('gateway serves the icons',
  (await fetch(DEVICE + '/__ipad-remote/icons/icon-180.png')).headers.get('content-type') === 'image/png')

check('WebSocket upgrade proxied to the real /api/remote.mux',
  await probeSocket('ws://' + DEVICE.replace(/^https?:\/\//, '') + '/api/remote.mux', { cookie }) === 'open')
check('unauthenticated WebSocket refused',
  await probeSocket('ws://' + DEVICE.replace(/^https?:\/\//, '') + '/api/remote.mux') !== 'open')

console.log(failures === 0 ? '\nALL LIVE CHECKS PASSED' : '\n' + failures + ' LIVE CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
