/**
 * Read the OFFICIAL Web GUI's live DOM and report which semantic anchors the
 * portrait-touch layer may key on.
 *
 * Why this exists: an adaptation layer selects official CSS-Modules classes by
 * their semantic SUFFIX (\`[class$="_composerSeat"]\`), which survives upstream
 * rebuilds that only change the hash. But nothing in this repository can tell
 * whether those names still exist in the GUI actually installed here — the chat
 * surface is not a static asset of index.html (it arrives through the client
 * module system), so scanning the served bundles proves nothing. This drives a
 * headless Edge over the Chrome DevTools Protocol, logs in through the PIN gate,
 * renders the real GUI at an iPad portrait viewport, and dumps the vocabulary it
 * finds. Re-run it after every Harness upgrade.
 *
 * No dependencies: Edge ships with Windows and the DevTools protocol is plain
 * JSON over a WebSocket.
 *
 * Usage:
 *   node scripts/inspect-gui-dom.mjs
 *   node scripts/inspect-gui-dom.mjs --port 50070 --pin 123456 --out docs/gui-selectors.md
 *
 * Exit codes: 0 = inventory written, 1 = the GUI could not be rendered.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Chromium's default DevTools port; ours, so a user's own Edge is never touched. */
const CDP_PORT = 9333

/** Edge install candidates, most specific first. */
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

/** Semantic suffixes the adaptation layer wants to anchor on. */
const ANCHORS = [
  'composerSeat', 'centerCol', 'sidebarCol', 'detailsCol', 'railFish', 'panelIcon',
  'newSession', 'sessionRow', 'projectRow', 'scrollBody', 'titleRow', 'titleCluster',
  'headerActions', 'headerUtilities', 'logoRow', 'rowActions', 'iconButton',
  'menu', 'cell', 'bubble', 'frame', 'card', 'tabs', 'tab', 'overlay', 'panel',
  'nav', 'workbench', 'track', 'primary', 'add', 'modes', 'trailing', 'input',
  'composer', 'gear', 'settings',
]

/** Attribute hooks, which outlive class hashes. */
const ATTRIBUTES = [
  'data-dsh-plugin', 'data-dsh-surface', 'data-dsh-frame', 'data-sidebar-collapsed',
  'data-slot', 'data-platform', 'role',
]

/** Read CLI flags given as \`--name value\` pairs. */
function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (key === undefined || !key.startsWith('--')) continue
    parsed[key.slice(2)] = argv[i + 1]
  }
  return parsed
}

const args = parseArgs(process.argv.slice(2))
const HOST = args.host ?? '127.0.0.1'
const PORT = Number(args.port ?? 50070)
const PIN = args.pin
if (PIN === undefined) throw new Error('pass --pin <the gateway PIN>')
const OUT = args.out ?? 'docs/gui-selectors.md'
const BASE = 'http://' + HOST + ':' + String(PORT)
const ENDPOINT = 'http://127.0.0.1:' + String(CDP_PORT)
const PAGE_CODE = String.raw

/** Minimal CDP client: one WebSocket, one promise per command id. */
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

  /**
   * Connect to a target.
   * @param webSocketDebuggerUrl - the target's DevTools socket.
   * @param options - \`page: true\` also enables the Page and Runtime domains.
   *   A browser-level target does not implement them.
   */
  static async connect(webSocketDebuggerUrl, options = {}) {
    const socket = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
    })
    const client = new Cdp(socket)
    if (options.page === true) {
      await client.send('Page.enable')
      await client.send('Runtime.enable')
    }
    return client
  }

  send(method, params = {}) {
    const id = this.#next++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(method + ' timed out'))
      }, 60_000)
    })
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails !== undefined) {
      const details = result.exceptionDetails
      throw new Error('page threw: ' + String(details.exception?.description ?? details.text))
    }
    return result.result.value
  }

  close() {
    try { this.#socket.close() } catch { /* already closed */ }
  }
}

/** Launch Edge headless unless a DevTools endpoint already answers. */
async function ensureBrowser() {
  try {
    await fetch(ENDPOINT + '/json/version')
    return null
  } catch { /* not running */ }

  const binary = EDGE_CANDIDATES.find(candidate => existsSync(candidate))
  if (binary === undefined) throw new Error('Edge not found; looked in ' + EDGE_CANDIDATES.join(', '))
  const profile = mkdtempSync(join(tmpdir(), 'dsh-gui-audit-'))
  const child = spawn(binary, [
    '--headless=new',
    '--remote-debugging-port=' + String(CDP_PORT),
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=390,844',
    'about:blank',
  ], { stdio: 'ignore' })

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500))
    try {
      await fetch(ENDPOINT + '/json/version')
      return child
    } catch { /* keep waiting */ }
  }
  throw new Error('Edge never exposed ' + ENDPOINT)
}

/** Open a fresh page target and return its client. */
async function openPage() {
  const browserInfo = await (await fetch(ENDPOINT + '/json/version')).json()
  const browser = await Cdp.connect(browserInfo.webSocketDebuggerUrl)
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const list = await (await fetch(ENDPOINT + '/json/list')).json()
  const target = list.find(entry => entry.id === created.targetId)
  if (target === undefined) throw new Error('page target not found')
  return { browser, page: await Cdp.connect(target.webSocketDebuggerUrl, { page: true }) }
}

/** Poll until the condition function returns true in the page. */
async function waitFor(page, conditionSource, label, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await page.evaluate(conditionSource)
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('timed out waiting for ' + label)
}

console.log('gateway : ' + BASE)
const spawned = await ensureBrowser()
console.log('browser : ' + (spawned === null ? 'reused an existing DevTools endpoint' : 'launched headless Edge'))

const { browser, page } = await openPage()
let inventory
let ready
try {
await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await page.send('Page.navigate', { url: BASE + '/' })

await waitFor(page, PAGE_CODE`document.querySelector('form') !== null && document.querySelector('input') !== null`, 'the unlock form')
console.log('unlock  : form found')

const submitted = await page.evaluate(PAGE_CODE`(() => {
  const form = document.querySelector('form')
  const field = form.querySelector('input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(PIN)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  const button = form.querySelector('button[type="submit"], button')
  if (button !== null) button.click()
  else if (typeof form.requestSubmit === 'function') form.requestSubmit()
  else form.submit()
  return { path: location.pathname, hasButton: button !== null }
})()`)
console.log('unlock  : ' + JSON.stringify(submitted))

ready = await waitFor(page, PAGE_CODE`(() => {
  const frames = document.querySelectorAll('[class*="_frame"], [data-dsh-frame]').length
  const text = document.body === null ? 0 : document.body.innerText.length
  return frames > 0 && text > 200 ? { path: location.pathname, frames, text } : false
})()`, 'the chat frame')
console.log('rendered: ' + JSON.stringify(ready))

// A first-run notice covers the conversation on a profile that has not seen it.
// Dismiss it the way a user would, otherwise every screenshot below is a dialog.
const notice = await page.evaluate(PAGE_CODE`(() => {
  const buttons = [...document.querySelectorAll('button')]
  const target = buttons.find(button => /继续|Continue/i.test(button.textContent ?? ''))
  if (target === undefined) return 'none'
  target.click()
  return 'dismissed'
})()`)
console.log('notice  : ' + notice)
await new Promise(resolve => setTimeout(resolve, 1200))

// What the layer looks like on the real GUI can only be answered here: the
// gateway injects it into every index response, so the same stylesheet and
// runtime the plugin emits are applied to this page verbatim and measured. The
// page must still be open, which is why this runs before the inventory read.
const applyAdapt = process.argv.includes('--apply-adapt')
const ADAPT_MEDIA_QUERY_FOR_PAGE = '(orientation: portrait) and (max-width: 1099px)'
const { adaptCss, adaptScript } = await import('../packages/ipad-remote/lib/mobile-adapt.js')
const css = adaptCss()
const source = adaptScript()
const shot = async name => {
  const result = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('docs/verify-' + name + '.png', Buffer.from(result.data, 'base64'))
  console.log('  screenshot docs/verify-' + name + '.png')
}

// A wide viewport first: no rule may apply there, and the layer must report
// itself off rather than merely looking off.
await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
await new Promise(resolve => setTimeout(resolve, 800))
const desktop = await page.evaluate(PAGE_CODE`(() => ({
  viewport: window.innerWidth + 'x' + window.innerHeight,
  launcher: document.getElementById('ipadRemoteLauncher') === null ? 'absent' : 'present',
  bodyClass: document.body.classList.contains('ipad-remote-portrait'),
  inputFontSize: (() => { const element = document.querySelector('textarea, [class$="_input"]'); return element === null ? 'n/a' : getComputedStyle(element).fontSize })(),
}))()`)
console.log('desktop: ' + JSON.stringify(desktop))
if (applyAdapt) await shot('desktop-with-layer')

await page.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true })
// Headless Chromium reports a fine pointer; an iPad reports coarse. Emulate it so
// the predicate under test is the one a real device satisfies.
await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] })
await new Promise(resolve => setTimeout(resolve, 1000))
if (applyAdapt) await shot('phone-before')

// Force the layer through its own documented override rather than injecting
// duplicate hooks: this is the same code path a phone takes, with the media query
// short-circuited.
await page.evaluate(PAGE_CODE`(() => {
  const style = document.createElement('style')
  style.setAttribute('data-verify', 'mobile-adapt')
  style.textContent = ${JSON.stringify(css)}
  document.head.appendChild(style)
  return 'style-in'
})()`)
await page.evaluate(PAGE_CODE`(() => {
  const element = document.createElement('script')
  element.textContent = ${JSON.stringify(source)}
  document.body.appendChild(element)
  return 'script-in'
})()`)
const before = await page.evaluate(PAGE_CODE`(() => ({
  launcher: document.getElementById('ipadRemoteLauncher') === null ? 'absent' : 'present',
  bodyClass: document.body.classList.contains('ipad-remote-portrait'),
  inputFontSize: (() => { const element = document.querySelector('textarea, [class$="_input"]'); return element === null ? 'n/a' : getComputedStyle(element).fontSize })(),
}))()`)
console.log('gate   : ' + JSON.stringify(before) + '   (media query does not match here: headless reports a fine pointer)')
await page.send('Page.navigate', { url: BASE + '/?adapt=force' })
await new Promise(resolve => setTimeout(resolve, 4000))
const direct = await page.evaluate(PAGE_CODE`(() => {
  try {
    const value = (0, eval)(${JSON.stringify(source)})
    return 'ran: ' + String(value)
  } catch (error) {
    const line = String(error && error.stack ? error.stack : error).split(String.fromCharCode(10))[0]
    return 'threw: ' + line
  }
})()`)
console.log('direct : ' + direct)
await new Promise(resolve => setTimeout(resolve, 1500))

const phone = await page.evaluate(PAGE_CODE`(() => {
  const target = document.getElementById('ipadRemoteLauncher')
  const probe = selector => {
    const element = document.querySelector(selector)
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      fontSize: style.fontSize,
      paddingBottom: style.paddingBottom,
    }
  }
  return {
    viewport: window.innerWidth + 'x' + window.innerHeight,
    url: location.pathname + location.search,
    mediaMatches: window.matchMedia(${JSON.stringify(ADAPT_MEDIA_QUERY_FOR_PAGE)}).matches,
    launcher: target === null ? null : { w: target.offsetWidth, h: target.offsetHeight, left: target.offsetLeft, top: target.offsetTop },
    bodyClass: document.body.classList.contains('ipad-remote-portrait'),
    composerInput: probe('textarea, [class$="_input"]'),
    composerSeat: probe('[class$="_composerSeat"]'),
    titleRow: probe('[class$="_titleRow"]'),
    tooltipRule: [...document.styleSheets].some(sheet => {
      try { return [...sheet.cssRules].some(rule => rule.cssText.includes('role="tooltip"')) } catch (error) { return false }
    }),
  }
})()`)
const inspect = await page.evaluate(PAGE_CODE`(() => {
  const style = element => {
    if (element === null) return null
    const computed = getComputedStyle(element)
    return {
      tag: element.tagName,
      cls: String(element.className).slice(0, 60),
      inline: element.getAttribute('style'),
      width: computed.width,
      height: computed.height,
      fontSize: computed.fontSize,
      matched: [...document.styleSheets].flatMap(sheet => {
        try { return [...sheet.cssRules] } catch (error) { return [] }
      }).flatMap(rule => {
        if (rule.cssText === undefined) return []
        const selectors = rule.selectorText === undefined ? [] : rule.selectorText.split(',')
        return selectors.filter(selector => {
          try { return element.matches(selector.trim()) } catch (error) { return false }
        }).map(selector => selector.trim() + ' => ' + (rule.style.fontSize || rule.style.width || rule.style.minWidth || '(other)'))
      }),
    }
  }
  return {
    launcher: style(document.getElementById('ipadRemoteLauncher')),
    textarea: style(document.querySelector('textarea')),
    inputish: style(document.querySelector('[class*="_input"]')),
  }
})()`)
console.log('inspect: ' + JSON.stringify(inspect, null, 1))
console.log('phone  : ' + JSON.stringify(phone, null, 1))
if (applyAdapt) await shot('phone-after')

inventory = await page.evaluate(PAGE_CODE`(() => {
  const anchors = ${JSON.stringify(ANCHORS)}
  const attributes = ${JSON.stringify(ATTRIBUTES)}
  const names = new Set()
  for (const element of document.querySelectorAll('*')) for (const name of element.classList) names.add(name)
  const matched = {}
  for (const anchor of anchors) {
    matched[anchor] = [...names].filter(name => name.toLowerCase().includes(anchor.toLowerCase())).slice(0, 14)
  }
  const attributeValues = {}
  for (const attribute of attributes) {
    const values = new Set()
    for (const element of document.querySelectorAll('[' + attribute + ']')) values.add(element.getAttribute(attribute) ?? '')
    attributeValues[attribute] = [...values].slice(0, 40)
  }
  return {
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    portraitTouch: window.matchMedia('(orientation: portrait)').matches && window.matchMedia('(pointer: coarse)').matches,
    elements: document.querySelectorAll('*').length,
    elementsWithClass: document.querySelectorAll('[class]').length,
    matched,
    attributeValues,
  }
})()`)

} finally {
  page.close()
  browser.close()
  if (spawned !== null) spawned.kill()
}

const hit = Object.entries(inventory.matched).filter(([, found]) => found.length > 0)
const miss = Object.entries(inventory.matched).filter(([, found]) => found.length === 0)
const lines = [
  '# Official GUI selector inventory',
  '',
  'Generated by \`node scripts/inspect-gui-dom.mjs\` against the running Harness behind the iPad gateway.',
  'Re-run after every Harness upgrade: a rule whose anchor disappears here is a rule that silently stopped applying.',
  '',
  '- gateway: ' + BASE,
  '- captured: ' + new Date().toISOString(),
  '- viewport: ' + String(inventory.viewport.width) + 'x' + String(inventory.viewport.height) +
    ' (portrait+coarse: ' + String(inventory.portraitTouch) + ')',
  '- elements: ' + String(inventory.elements) + ' (' + String(inventory.elementsWithClass) + ' with classes)',
  '- page title: ' + inventory.title,
  '',
  '## Anchors found (' + String(hit.length) + '/' + String(Object.keys(inventory.matched).length) + ')',
  '',
  '| anchor | matching class names |',
  '|---|---|',
  ...hit.map(([anchor, found]) => '| \`' + anchor + '\` | ' + found.map(name => '\`' + name + '\`').join(', ') + ' |'),
  '',
  '## Anchors NOT present',
  '',
  miss.length === 0 ? '(none)' : miss.map(([anchor]) => '- \`' + anchor + '\`').join('\n'),
  '',
  '## Attribute hooks',
  '',
  '| attribute | values |',
  '|---|---|',
  ...Object.entries(inventory.attributeValues).map(([attribute, values]) =>
    '| \`' + attribute + '\` | ' + (values.length === 0 ? '(absent)' : values.map(value => '\`' + value + '\`').join(', ')) + ' |'),
  '',
]

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log('')
console.log('anchors found: ' + String(hit.length) + ' / ' + String(Object.keys(inventory.matched).length))
for (const [anchor, found] of hit) console.log('  ' + anchor.padEnd(20) + found.slice(0, 4).join(', '))
if (miss.length > 0) console.log('anchors missing: ' + miss.map(([anchor]) => anchor).join(', '))
console.log('written: ' + OUT)
