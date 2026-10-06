/**
 * Reproduce the workspace picker through the gateway, the way a phone or tablet
 * reaches it, and report what actually happens.
 *
 * The host composition is knowable from a config dump, but the symptom is in the
 * browser: the in-app picker is mounted (directory-picker-auto is disabled), so
 * either the dialog never appears, appears broken, or its request fails through
 * the reverse proxy. This drives the real page, clicks the workspace entry, and
 * dumps the dialog, the console, and every failed response.
 *
 * Env:
 *   PROBE_DEVICE   gateway origin (default https://127.0.0.1:50071)
 *   PROBE_PIN      access PIN (required)
 *   PROBE_SHOTS    screenshot directory (default docs/verification)
 *   PROBE_WIDTH    viewport width (default 430, phone portrait); PROBE_HEIGHT default 932
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DEVICE = process.env.PROBE_DEVICE ?? 'https://127.0.0.1:50071'
const PIN = process.env.PROBE_PIN
if (PIN === undefined) throw new Error('set PROBE_PIN to the gateway PIN')
const SHOTS = process.env.PROBE_SHOTS ?? 'docs/verification'
const WIDTH = Number(process.env.PROBE_WIDTH ?? 430)
const HEIGHT = Number(process.env.PROBE_HEIGHT ?? 932)

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
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const specifier = candidate.startsWith('playwright') ? candidate : 'file:///' + candidate.replace(/\\/g, '/')
    try { return await import(specifier) } catch { /* next */ }
  }
  return null
}

const playwright = await loadPlaywright()
if (playwright === null) {
  console.error('SKIP  playwright is not available; pass PLAYWRIGHT_ENTRY')
  process.exit(0)
}
mkdirSync(SHOTS, { recursive: true })
const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
  userAgent: undefined,
})
const page = await context.newPage()
const consoleErrors = []
const failedResponses = []
const pickerCalls = []
page.on('console', message => {
  if (message.type() !== 'error') return
  const where = message.location()?.url ?? ''
  consoleErrors.push(where === '' ? message.text() : message.text() + '  @ ' + new URL(where).pathname)
})
page.on('pageerror', error => { consoleErrors.push(String(error)) })
page.on('response', response => {
  const url = response.url()
  if (response.status() >= 400) failedResponses.push(String(response.status()) + ' ' + url)
  if (/picker|workspace|director|folder/i.test(url) && !/\\.(js|css|png|svg|woff2?)(\\?|$)/i.test(url)) pickerCalls.push(String(response.status()) + ' ' + new URL(url).pathname)
})

console.log('device : ' + DEVICE)
console.log('viewport: ' + String(WIDTH) + 'x' + String(HEIGHT))
await page.goto(DEVICE + '/', { waitUntil: 'load' })
console.log('unlock : ' + page.url())
await page.fill('#pin', PIN)
await Promise.all([page.waitForLoadState('load'), page.click('button[type="submit"]')])
await page.waitForSelector('#root > *', { timeout: 40000 })
await page.waitForTimeout(3000)

// First-run release notes own the modal layer and would swallow the click.
for (const label of [/^继续$/, /^Continue$/, /^知道了$/, /^Got it$/]) {
  const button = page.getByRole('button', { name: label }).first()
  if (await button.isVisible().catch(() => false)) { await button.click(); await page.waitForTimeout(800); break }
}
await page.screenshot({ path: join(SHOTS, 'picker-00-loaded.png') })

// Inventory every semantic slot and control first: the workspace area is not
// one button, and guessing which one means guessing at the bug.
const inventory = await page.evaluate(() => {
  const slots = [...new Set([...document.querySelectorAll('[data-slot]')].map(element => element.getAttribute('data-slot')))]
  const controls = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')].slice(0, 60).map(element => ({
    slot: element.getAttribute('data-slot') ?? '',
    label: element.getAttribute('aria-label') ?? '',
    title: element.getAttribute('title') ?? '',
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30),
    visible: element.getBoundingClientRect().width > 0,
  })).filter(control => control.label || control.text)
  return { slots, controls }
})
console.log('slots (' + String(inventory.slots.length) + '): ' + inventory.slots.filter(slot => /workspace|directory|folder|project|session/i.test(String(slot))).join(', '))
for (const control of inventory.controls.filter(control => /工作区|目录|文件夹|新建|添加|workspace|director|folder|new|add/i.test(control.label + ' ' + control.text))) {
  console.log('  candidate ' + JSON.stringify(control))
}

// Prefer the hero workspace flow (a fresh session shows it), then the sidebar row.
const candidates = [
  '[data-slot="conversation.hero.workspace.directoryFlow"]',
  '[data-slot="sidebar.workspaces.directoryFlow"]',
  'button[aria-label*="工作区"], button[aria-label*="目录"]',
  'button[title*="工作区"], button[title*="目录"]',
]
let entry = null
let usedSelector = null
for (const selector of candidates) {
  const locator = page.locator(selector).first()
  if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) { entry = locator; usedSelector = selector; break }
}
console.log('entry  : ' + (entry === null ? 'NOT FOUND' : usedSelector))
if (entry !== null) {
  await entry.click()
  await page.waitForTimeout(2500)
  const dialogs = page.locator('[role="dialog"]')
  console.log('dialogs: ' + String(await dialogs.count()))
  for (let index = 0; index < await dialogs.count(); index += 1) {
    const dialog = dialogs.nth(index)
    const visible = await dialog.isVisible().catch(() => false)
    const box = await dialog.boundingBox().catch(() => null)
    const text = (await dialog.innerText().catch(() => '')).replace(/\\s+/g, ' ').slice(0, 400)
    console.log('  dialog[' + String(index) + '] visible=' + String(visible) + ' box=' + JSON.stringify(box) + ' text=' + text)
  }
  const menu = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="menuitem"], [role="menu"] button, [class*="_menu"] button')]
      .filter(element => element.getBoundingClientRect().width > 0)
      .map(element => ({
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        label: element.getAttribute('aria-label') ?? '',
        cls: String(element.className).slice(0, 40),
      }))
    return items
  })
  console.log('menu items (' + String(menu.length) + '):')
  for (const item of menu) console.log('  item ' + JSON.stringify(item))
  const pickerItem = page.locator('[role="menuitem"], [role="menu"] button, [class*="_menu"] button').filter({ hasText: /选择目录|选择文件夹|新目录|打开文件夹|新建工作区|添加工作区|Choose|New folder|Add workspace|Open folder/i }).first()
  const pickerVisible = await pickerItem.count() > 0 && await pickerItem.isVisible().catch(() => false)
  console.log('new-directory entry: ' + String(pickerVisible))
  if (pickerVisible) {
    await pickerItem.click()
    await page.waitForTimeout(2500)
    const dialogCount = await page.locator('[role="dialog"]').count()
    console.log('dialog after choosing the entry: ' + String(dialogCount))
    if (dialogCount > 0) {
      const text = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      console.log('dialog text: ' + text)
    }
    await page.screenshot({ path: join(SHOTS, 'picker-02-dialog.png') })
  }
  const surfaces = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    overlays: [...document.querySelectorAll('[class*="_overlay"]')].map(element => ({
      cls: String(element.className).slice(0, 60),
      visible: element.getBoundingClientRect().width > 0,
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    })).slice(0, 6),
    pickerish: [...document.querySelectorAll('*')].filter(element => /选择目录|浏览|文件夹|驱动器|Choose|Browse|Folder|Drive/i.test(element.textContent ?? '') && element.children.length === 0).slice(0, 8).map(element => (element.textContent ?? '').trim().slice(0, 60)),
    toasts: [...document.querySelectorAll('[class*="toast" i], [role="alert"]')].map(element => (element.textContent ?? '').trim().slice(0, 160)).slice(0, 5),
  }))
  console.log('surfaces: ' + JSON.stringify(surfaces, null, 1))
  await page.screenshot({ path: join(SHOTS, 'picker-01-after-click.png') })
}

console.log('picker calls:')
for (const call of pickerCalls.slice(0, 20)) console.log('  ' + call)
console.log('failed responses: ' + (failedResponses.length === 0 ? 'none' : ''))
for (const failure of failedResponses.slice(0, 15)) console.log('  ' + failure)
console.log('console errors: ' + (consoleErrors.length === 0 ? 'none' : ''))
for (const error of consoleErrors.slice(0, 10)) console.log('  ' + error.slice(0, 240))
await browser.close()
