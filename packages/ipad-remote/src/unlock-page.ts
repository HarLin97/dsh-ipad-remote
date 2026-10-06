/**
 * The device-facing unlock page.
 *
 * Deliberately standalone: it is served by the gateway before any Harness asset
 * has loaded, so it cannot use Harness design tokens or components. It stays
 * dependency-free (no external fonts, scripts or styles) so it renders on a
 * tablet on a network with no internet access.
 * @module @harlin97/dsh-ipad-remote/unlock-page
 */

import { DEVICE_PREFIX } from './contract.js'
import { PIN_LENGTH } from './store.js'

/** Unlock page path. */
export const UNLOCK_PATH = `${DEVICE_PREFIX}/unlock`

/** Unlock form submission path. */
export const UNLOCK_SUBMIT_PATH = `${DEVICE_PREFIX}/unlock`

/** Logout path. */
export const LOGOUT_PATH = `${DEVICE_PREFIX}/logout`

/**
 * Escape text for interpolation into HTML.
 * @param value - untrusted text.
 * @returns HTML-safe text.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Inputs for one unlock page render. */
export interface UnlockPageInput {
  /** Human-readable failure to show, already localized. */
  error?: string
  /** Seconds the client should wait before retrying. */
  retryAfterSeconds?: number
}

/**
 * Render the unlock page.
 * @param input - optional error state.
 * @returns a complete HTML document.
 */
export function renderUnlockPage(input: UnlockPageInput = {}): string {
  const errorBlock = input.error === undefined
    ? ''
    : `<p class="error" role="alert">${escapeHtml(input.error)}${
      input.retryAfterSeconds === undefined ? '' : ` ${String(input.retryAfterSeconds)} 秒后重试。`}</p>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<title>解锁 DeepSeek Harness</title>
<style>
  :root { color-scheme: light dark; --bg:#f5f5f7; --surface:#fff; --text:#1d1d1f; --muted:#6e6e73; --line:#d2d2d7; --accent:#0a84ff; --error:#d70015; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1c1c1e; --surface:#2c2c2e; --text:#f5f5f7; --muted:#98989d; --line:#3a3a3c; --error:#ff453a; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--text); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         padding:max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom)); }
  main { width:100%; max-width:380px; background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:28px; }
  h1 { font-size:20px; margin:0 0 6px; }
  p.lead { margin:0 0 20px; color:var(--muted); font-size:14px; }
  label { display:block; font-size:13px; font-weight:600; margin-bottom:8px; }
  input { width:100%; height:52px; font-size:24px; letter-spacing:.35em; text-align:center;
          background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:0 12px; }
  input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  button { width:100%; height:46px; margin-top:16px; border:0; border-radius:10px;
           background:var(--accent); color:#fff; font-size:16px; font-weight:600; cursor:pointer; }
  button:focus-visible { outline:2px solid var(--text); outline-offset:2px; }
  p.error { margin:0 0 16px; color:var(--error); font-size:14px; }
  p.hint { margin:16px 0 0; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<main>
  <h1>解锁 DeepSeek Harness</h1>
  <p class="lead">这台设备需要输入 PIN 才能访问桌面端。</p>
  ${errorBlock}
  <form method="post" action="${UNLOCK_SUBMIT_PATH}">
    <label for="pin">PIN</label>
    <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*"
           maxlength="${String(PIN_LENGTH)}" autocomplete="one-time-code" autofocus required />
    <button type="submit">解锁</button>
  </form>
  <p class="hint">PIN 由桌面端 Harness 的「PWA 远程访问」设置中设置。</p>
</main>
</body>
</html>
`
}
