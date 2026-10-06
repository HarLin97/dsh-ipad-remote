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
/** Path the gateway serves the worker from. */
export declare const SERVICE_WORKER_PATH = "/__ipad-remote/sw.js";
/** Scope the worker claims; the app lives at the root, so the fallback can reach it. */
export declare const SERVICE_WORKER_SCOPE = "/";
/**
 * Global the gateway sets in every document it proxies. Its absence is what keeps
 * the worker off the desktop app's own origin.
 */
export declare const GATEWAY_MARKER = "__IPAD_REMOTE_GATEWAY__";
/** Idempotence marker for the injected registration snippet. */
export declare const REGISTRATION_MARKER = "<!-- ipad-remote:service-worker -->";
/**
 * Version of this package, read from the manifest beside the built module.
 *
 * It names the cache, so a rebuilt plugin retires the previous shell on the next
 * activation instead of serving it forever.
 * @returns the version, or `dev` when the manifest cannot be read.
 */
export declare function pluginVersion(): Promise<string>;
/**
 * The worker source, versioned and served verbatim.
 * @param version - cache-naming version.
 * @returns the worker script.
 */
export declare function renderServiceWorker(version: string): string;
/**
 * The snippet injected into every index document.
 *
 * Deferred to `load` because the gateway mark is injected on the way out, after
 * this script is already in the head — by `load` the document is complete.
 * @returns the script source.
 */
export declare function renderRegistrationScript(): string;
