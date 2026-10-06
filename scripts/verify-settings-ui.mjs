/**
 * Render the remote-access settings section in a real browser, over the same
 * path an iPad takes.
 *
 * The unit tests and live probe prove the bundle is composed and served; only a
 * browser proves the section actually mounts. This unlocks the gateway with the
 * PIN, loads the proxied Harness UI, opens Settings, selects the section,
 * asserts its controls, captures the console, and writes screenshots.
 *
 * Env:
 *   PROBE_DEVICE     gateway origin (default http://127.0.0.1:50075)
 *   PROBE_PIN        access PIN (required)
 *   PROBE_SHOTS      screenshot directory (default docs/verification)
 *   PLAYWRIGHT_ENTRY explicit playwright ESM entry, when this repo cannot resolve it
 *   HARNESS_CHECKOUT harness checkout to borrow playwright from (required)
 */
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DEVICE = process.env.PROBE_DEVICE ?? 'http://127.0.0.1:50075'
const PIN = process.env.PROBE_PIN
if (PIN === undefined) throw new Error('set PROBE_PIN to the gateway PIN')
const SHOTS = process.env.PROBE_SHOTS ?? 'docs/verification'

/** Resolve playwright from this repo, the harness checkout, or an explicit path. */
async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_ENTRY]
  const checkout = process.env.HARNESS_CHECKOUT
  if (checkout === undefined) return null
  const store = join(checkout, 'node_modules/.pnpm')
  if (existsSync(store)) {
    for (const dir of readdirSync(store).filter(name => name.startsWith('playwright@')).sort()) {
      candidates.push(join(store, dir, 'node_modules/playwright/index.mjs'))
    }
  }
  try {
    createRequire(import.meta.url).resolve('playwright')
    candidates.push('playwright')
  } catch { /* not a dependency of this repo */ }
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const specifier = candidate.startsWith('playwright') ? candidate : 'file:///' + candidate.replace(/\\/g, '/')
    try {
      return await import(specifier)
    } catch { /* try the next one */ }
  }
  return null
}

const playwright = await loadPlaywright()
if (playwright === null) {
  console.error('SKIP  playwright is not available; pass PLAYWRIGHT_ENTRY')
  process.exit(0)
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  -> ' + detail : ''))
  if (!ok) failures += 1
}

mkdirSync(SHOTS, { recursive: true })
const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await context.newPage()

const consoleErrors = []
/** HTTP failures, with the URL the console message omits. */
const failedResponses = []
page.on('console', message => {
  if (message.type() !== 'error') return
  const where = message.location()?.url ?? ''
  consoleErrors.push(where === '' ? message.text() : message.text() + ' @ ' + where)
})
page.on('pageerror', error => { consoleErrors.push(String(error)) })
page.on('response', response => {
  if (response.status() >= 400) failedResponses.push(response.status() + ' ' + response.url())
})

// 1. The iPad path: unlock with the PIN, then land on the proxied Harness UI.
await page.goto(DEVICE + '/', { waitUntil: 'load' })
check('unauthenticated navigation reaches the unlock page', page.url().includes('/__ipad-remote/unlock'), page.url())
await page.fill('#pin', PIN)
await Promise.all([page.waitForLoadState('load'), page.click('button[type="submit"]')])
await page.waitForTimeout(1000)
check('PIN unlocks the proxied Harness UI', !page.url().includes('unlock'), page.url())

await page.waitForSelector('#root > *', { timeout: 40000 })
// Plugin bundles arrive lazily; let the composition settle before reading the UI.
await page.waitForTimeout(3000)

// The first run shows the release-notes dialog, which owns the modal layer and
// blocks the Settings shortcut; a session that already dismissed it shows none.
for (const label of [/^继续$/, /^Continue$/, /^知道了$/, /^Got it$/]) {
  const button = page.getByRole('button', { name: label }).first()
  if (await button.isVisible().catch(() => false)) {
    await button.click()
    await page.waitForTimeout(800)
    break
  }
}
await page.screenshot({ path: join(SHOTS, '01-harness.png') })

// 2. Open Settings with the shell's own shortcut rather than a chrome selector
//    that depends on sidebar width and locale. In a browser on Windows the
//    shell binds Ctrl+Alt+Comma (the desktop app binds Ctrl+Comma).
await page.keyboard.press('Control+Alt+Comma')
await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: join(SHOTS, '02-settings.png') })

const navItem = page.getByText(/iPad 远程访问|iPad Remote Access/).first()
const navVisible = await navItem.isVisible().catch(() => false)
check('Settings lists the remote-access section', navVisible)
if (navVisible) {
  await navItem.click()
  await page.waitForTimeout(1200)
}

const text = await page.locator('body').innerText()
check('section renders the remote-access switch', (await page.locator('[role="switch"]').count()) > 0)
check('section renders the PIN field', (await page.locator('input[type="password"]').count()) > 0)
check('section renders a scannable address code', (await page.locator('svg[role="img"]').count()) > 0)
check('section shows the enable copy', /允许远程访问|Allow remote access/.test(text))
check('section shows the PIN copy', /访问 PIN|Access PIN/.test(text))
check('section shows the address copy', /在 iPad 上打开|Open on the iPad/.test(text))
check('section shows the unlocked-device copy', /已解锁的设备|Unlocked devices/.test(text))
await page.screenshot({ path: join(SHOTS, '03-section.png'), fullPage: true })

const actionable = consoleErrors.filter(text => !/favicon|net::ERR_/i.test(text))
check('browser console is clean', actionable.length === 0, actionable.slice(0, 3).join(' | '))
if (actionable.length > 0) console.log('   console detail: ' + actionable.join('\n   '))
check('no request failed', failedResponses.length === 0, failedResponses.slice(0, 5).join(' | '))

await browser.close()
console.log(failures === 0 ? '\nUI CHECKS PASSED' : '\n' + failures + ' UI CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
