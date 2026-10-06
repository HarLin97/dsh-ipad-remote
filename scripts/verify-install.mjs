/**
 * Verify a live installation end to end, the way the iPad reaches it.
 *
 * Usage: node scripts/verify-install.mjs <harnessPort> [deviceHost] [pin]
 *
 * The Harness port changes on every restart (it is OS-assigned), so it must be
 * passed in. The gateway port is fixed by the plugin's own state file.
 */
import { readFileSync } from 'node:fs'

const harnessPort = process.argv[2]
const deviceHost = process.argv[3] ?? process.env.PROBE_HOST
if (deviceHost === undefined) throw new Error('pass the LAN address or set PROBE_HOST')
const pin = process.argv[4] ?? process.env.PROBE_PIN
if (pin === undefined) throw new Error('pass the PIN or set PROBE_PIN')
if (harnessPort === undefined) {
  console.error('usage: node scripts/verify-install.mjs <harnessPort> [deviceHost] [pin]')
  process.exit(2)
}

const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const state = JSON.parse(readFileSync(HOME + '/plugins/ipad-remote/config.json', 'utf8'))
const HARNESS = 'http://127.0.0.1:' + harnessPort
const DEVICE = 'http://' + deviceHost + ':' + state.port
let bad = 0
const check = (label, ok, detail = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  -> ' + detail : ''))
  if (!ok) bad += 1
}

const status = await (await fetch(HARNESS + '/ipad-remote/api/status')).json()
check('control surface reachable inside the Harness', status.listening === true, 'port=' + status.port)
check('gateway is enabled and has a PIN', status.enabled === true && status.hasPin === true)
check('a LAN address is advertised', /^http:\/\/.+:\d+\/$/.test(status.addresses[0]?.url ?? ''), status.addresses[0]?.url ?? '(none)')

const page = await fetch(DEVICE + '/__ipad-remote/unlock')
check('unlock page reachable over the LAN', page.status === 200 && (await page.text()).includes('解锁'))

const wrong = await fetch(DEVICE + '/__ipad-remote/unlock', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=000000', redirect: 'manual',
})
check('wrong PIN rejected', wrong.status === 401, String(wrong.status))

const right = await fetch(DEVICE + '/__ipad-remote/unlock', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=' + pin, redirect: 'manual',
})
const cookie = (right.headers.getSetCookie()[0] ?? '').split(';')[0]
check('correct PIN issues a session', right.status === 303 && cookie.length > 0)

const app = await fetch(DEVICE + '/', { headers: { cookie } })
const html = await app.text()
check('gateway proxies the real Harness UI', app.status === 200 && html.includes('id="root"'), html.length + ' bytes')
check('PWA tags are injected', html.includes('ipad-remote:pwa') && html.includes('viewport-fit=cover'))

console.log(bad === 0 ? '\nINSTALLATION VERIFIED' : '\n' + bad + ' CHECK(S) FAILED')
process.exit(bad === 0 ? 0 : 1)
