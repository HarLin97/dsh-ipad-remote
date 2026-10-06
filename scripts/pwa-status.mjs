/**
 * Read-only status probe for the installed iPad gateway.
 *
 * Answers one question: can an iPad install this as a home-screen app right
 * now? It does not mutate anything (no PIN change, no enable/disable) — unlike
 * scripts/live-probe.mjs, which drives the control surface on a fresh instance.
 *
 * Usage: node scripts/pwa-status.mjs <harnessPort> [deviceHost]
 */
import { readFileSync } from 'node:fs'

const harnessPort = process.argv[2]
const host = process.argv[3] ?? process.env.PROBE_HOST ?? '127.0.0.1'
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const statePath = HOME + '/plugins/ipad-remote/config.json'
let bad = 0
const check = (label, ok, detail = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  -> ' + detail : ''))
  if (!ok) bad += 1
}

let state
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'))
} catch (error) {
  console.error('cannot read ' + statePath + ': ' + String(error.message))
  process.exit(2)
}
const DEVICE = 'http://' + host + ':' + String(state.port)
console.log('state file : ' + statePath)
console.log('device base: ' + DEVICE)
console.log('hasPin     : ' + String(state.hasPin ?? '(not recorded in the state file)'))
console.log('')

if (harnessPort !== undefined) {
  const control = await (await fetch('http://127.0.0.1:' + harnessPort + '/ipad-remote/api/status')).json()
  check('control surface answers', control.listening === true, 'port=' + String(control.port) + ' enabled=' + String(control.enabled) + ' hasPin=' + String(control.hasPin))
  console.log('advertised : ' + (control.addresses ?? []).map(a => a.url).join('  '))
} else {
  console.log('(no harness port passed: skipping the loopback control check)')
}
console.log('')

const anon = await fetch(DEVICE + '/', { redirect: 'manual', headers: { accept: 'text/html' } })
check('gateway is listening over the LAN', anon.status === 303 || anon.status === 200 || anon.status === 401, 'status=' + String(anon.status))

const unlock = await fetch(DEVICE + '/__ipad-remote/unlock')
check('unlock page reachable', unlock.status === 200)

const manifestResponse = await fetch(DEVICE + '/manifest.webmanifest', { redirect: 'manual' })
const manifestText = await manifestResponse.text()
check('manifest served unauthenticated to the iPad', manifestResponse.status === 200, 'status=' + String(manifestResponse.status) + ' type=' + String(manifestResponse.headers.get('content-type')))
let manifest = null
try { manifest = JSON.parse(manifestText) } catch { /* reported below */ }
check('manifest is valid JSON', manifest !== null)
if (manifest !== null) {
  check('display=standalone (iOS opens without browser chrome)', manifest.display === 'standalone', 'display=' + String(manifest.display))
  check('start_url and scope are relative to the gateway root', manifest.start_url === './' && manifest.scope === './', 'start_url=' + String(manifest.start_url) + ' scope=' + String(manifest.scope))
  check('name and short_name present', Boolean(manifest.name) && Boolean(manifest.short_name), String(manifest.name) + ' / ' + String(manifest.short_name))
  check('theme_color and background_color present', Boolean(manifest.theme_color) && Boolean(manifest.background_color), String(manifest.theme_color) + ' / ' + String(manifest.background_color))
  for (const icon of manifest.icons ?? []) {
    const response = await fetch(DEVICE + icon.src, { redirect: 'manual' })
    const bytes = (await response.arrayBuffer()).byteLength
    check('icon ' + String(icon.sizes) + ' served', response.status === 200 && bytes > 0, 'status=' + String(response.status) + ' bytes=' + String(bytes) + ' type=' + String(response.headers.get('content-type')))
  }
  const apple = (manifest.icons ?? []).some(icon => icon.sizes === '180x180')
  check('180x180 icon declared for apple-touch-icon', apple)
}

console.log(bad === 0 ? '\nPWA ASSETS OK' : '\n' + String(bad) + ' CHECK(S) FAILED')
process.exit(bad === 0 ? 0 : 1)
