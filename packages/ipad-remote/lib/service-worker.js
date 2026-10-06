/**
 * The gateway's service worker, and the snippet that registers it.
 *
 * Three boundaries are deliberate, and each exists because the opposite would be
 * a bug rather than a trade-off:
 *
 * - **Registered only where the gateway served the page.** The desktop window and
 *   the gateway can share one machine, so a worker on the desktop's own origin
 *   could hand the desktop app stale assets. The gateway marks the documents it
 *   proxies, and the snippet below does nothing without that mark.
 * - **The control plane is never cached.** `/api`, the device API and the unlock
 *   route carry live Harness traffic and credentials; a cached answer there is
 *   wrong rather than merely stale, so those requests bypass the worker.
 * - **`cache-control: no-store` is honoured.** The browser bundle is served per
 *   request so a rebuilt plugin shows up on reload; caching it would undo that.
 *
 * What remains is the offline shell: navigations are network-first with a cached
 * fallback, so an offline open shows the last known page — or an explanation —
 * instead of a blank one.
 * @module @harlin97/dsh-ipad-remote/service-worker
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEVICE_PREFIX } from './contract.js';
/** Path the gateway serves the worker from. */
export const SERVICE_WORKER_PATH = `${DEVICE_PREFIX}/sw.js`;
/** Scope the worker claims; the app lives at the root, so the fallback can reach it. */
export const SERVICE_WORKER_SCOPE = '/';
/**
 * Global the gateway sets in every document it proxies. Its absence is what keeps
 * the worker off the desktop app's own origin.
 */
export const GATEWAY_MARKER = '__IPAD_REMOTE_GATEWAY__';
/** Idempotence marker for the injected registration snippet. */
export const REGISTRATION_MARKER = '<!-- ipad-remote:service-worker -->';
/** Placeholder the rendered body replaces with the JSON-quoted version. */
const VERSION_SLOT = '__DSH_IPAD_REMOTE_VERSION__';
/** Worker body, plain JavaScript, delivered to the browser verbatim. */
const BODY = [
    "'use strict'",
    "const VERSION = __DSH_IPAD_REMOTE_VERSION__",
    "const CACHE = \"dsh-ipad-remote-\" + VERSION",
    "const DEVICE = \"__DEVICE_PREFIX__\"",
    "const SHELL = [\"/\", \"/manifest.webmanifest\", DEVICE + \"/icons/icon-192.png\", DEVICE + \"/icons/icon-512.png\"]",
    "const BYPASS = [\"/api/\", DEVICE + \"/api/\", DEVICE + \"/unlock\"]",
    "const OFFLINE_HTML = \"<!doctype html><html lang='zh'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>主机没有响应</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1c1c1e;color:#f5f5f7;font:16px/1.6 -apple-system,system-ui,sans-serif}main{max-width:32rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0 0 .5rem;color:#a1a1a6}button{margin-top:1rem;padding:.6rem 1.1rem;border:0;border-radius:.6rem;background:#0a84ff;color:#fff;font:inherit}</style></head><body><main><h1>连不上主机</h1><p>这台设备之前连上过，但主机现在没有响应。确认桌面端 Harness 正在运行、并且和你处在同一个网络，然后重试。</p><p lang='en'>The host is not answering. Check that the desktop Harness is running and on the same network, then retry.</p><button onclick='location.reload()'>重试 / Retry</button></main></body></html>\"",
    "",
    "self.addEventListener(\"install\", function (event) {",
    "  event.waitUntil(caches.open(CACHE).then(function (cache) {",
    "    return Promise.all(SHELL.map(function (url) {",
    "      return cache.add(url).catch(function () { return undefined })",
    "    }))",
    "  }).then(function () { return self.skipWaiting() }))",
    "})",
    "",
    "self.addEventListener(\"activate\", function (event) {",
    "  event.waitUntil(caches.keys().then(function (keys) {",
    "    return Promise.all(keys.filter(function (key) { return key !== CACHE })",
    "      .map(function (key) { return caches.delete(key) }))",
    "  }).then(function () { return self.clients.claim() }))",
    "})",
    "",
    "self.addEventListener(\"fetch\", function (event) {",
    "  const request = event.request",
    "  if (request.method !== \"GET\") return",
    "  const url = new URL(request.url)",
    "  if (url.origin !== self.location.origin) return",
    "  if (BYPASS.some(function (prefix) { return url.pathname.indexOf(prefix) === 0 })) return",
    "  if (request.mode === \"navigate\") { event.respondWith(networkFirst(request)); return }",
    "  event.respondWith(staleWhileRevalidate(request))",
    "})",
    "",
    "function cacheable(answer) {",
    "  return answer.ok && answer.type === \"basic\" &&",
    "    !/no-store/i.test(answer.headers.get(\"cache-control\") || \"\")",
    "}",
    "",
    "function networkFirst(request) {",
    "  return fetch(request).then(function (answer) {",
    "    if (cacheable(answer)) {",
    "      const copy = answer.clone()",
    "      caches.open(CACHE).then(function (cache) { cache.put(request, copy) })",
    "    }",
    "    return answer",
    "  }).catch(function () {",
    "    return caches.match(request).then(function (cached) {",
    "      if (cached) return cached",
    "      return caches.match(\"/\").then(function (shell) {",
    "        if (shell) return shell",
    "        return new Response(OFFLINE_HTML, {",
    "          status: 503,",
    "          headers: { \"content-type\": \"text/html; charset=utf-8\" },",
    "        })",
    "      })",
    "    })",
    "  })",
    "}",
    "",
    "function staleWhileRevalidate(request) {",
    "  return caches.open(CACHE).then(function (cache) {",
    "    return cache.match(request).then(function (cached) {",
    "      const network = fetch(request).then(function (answer) {",
    "        if (cacheable(answer)) cache.put(request, answer.clone())",
    "        return answer",
    "      }).catch(function () { return undefined })",
    "      if (cached) return cached",
    "      return network.then(function (answer) { return answer || new Response(\"\", { status: 504 }) })",
    "    })",
    "  })",
    "}"
];
/**
 * Version of this package, read from the manifest beside the built module.
 *
 * It names the cache, so a rebuilt plugin retires the previous shell on the next
 * activation instead of serving it forever.
 * @returns the version, or `dev` when the manifest cannot be read.
 */
export async function pluginVersion() {
    try {
        const text = await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8');
        const parsed = JSON.parse(text);
        const version = parsed.version;
        return typeof version === 'string' ? version : 'dev';
    }
    catch {
        return 'dev';
    }
}
/**
 * The worker source, versioned and served verbatim.
 * @param version - cache-naming version.
 * @returns the worker script.
 */
export function renderServiceWorker(version) {
    return BODY.map(line => line.replace(VERSION_SLOT, JSON.stringify(version)).replaceAll('__DEVICE_PREFIX__', DEVICE_PREFIX)).join('\n');
}
/**
 * The snippet injected into every index document.
 *
 * Deferred to `load` because the gateway mark is injected on the way out, after
 * this script is already in the head — by `load` the document is complete.
 * @returns the script source.
 */
export function renderRegistrationScript() {
    return [
        '(function () {',
        '  window.addEventListener("load", function () {',
        '    if (window.' + GATEWAY_MARKER + ' !== true) return',
        '    if (!("serviceWorker" in navigator)) return',
        '    navigator.serviceWorker.register(' + JSON.stringify(SERVICE_WORKER_PATH) +
            ', { scope: ' + JSON.stringify(SERVICE_WORKER_SCOPE) + ' }).catch(function () {})',
        '  })',
        '})()',
    ].join('\n');
}
