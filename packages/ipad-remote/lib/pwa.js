/**
 * Progressive-web-app enhancement for the iPad home screen.
 *
 * Two halves, deliberately in different places:
 * - {@link enhanceIndexHtml} runs through the Harness webserver's public
 *   `tapIndex` hook, so it applies to every index response. The tags it adds
 *   are inert on desktop browsers.
 * - The manifest and the icons are served by the gateway only, so the desktop
 *   experience (and the upstream manifest) is left untouched.
 * @module @harlin97/dsh-ipad-remote/pwa
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEVICE_PREFIX } from './contract.js';
import { adaptCss, adaptScript } from './mobile-adapt.js';
import { REGISTRATION_MARKER, renderRegistrationScript } from './service-worker.js';
/** Path the gateway serves generated icons from. */
export const ICON_PREFIX = `${DEVICE_PREFIX}/icons`;
/** Manifest path the gateway intercepts and answers itself. */
export const MANIFEST_PATH = '/manifest.webmanifest';
/** Icon sizes shipped in `assets/`. */
export const ICON_SIZES = [180, 192, 512];
/** Idempotence marker, so repeated index renders never double-inject. */
const MARKER = '<!-- ipad-remote:pwa -->';
/** Idempotence marker for the portrait-touch stylesheet. */
const ADAPT_STYLE_MARKER = '/* ipad-remote:mobile-adapt */';
/** Idempotence marker for the portrait-touch runtime. */
const ADAPT_SCRIPT_MARKER = '<!-- ipad-remote:mobile-adapt -->';
/** Replaces the upstream viewport tag, which lacks `viewport-fit`. */
const VIEWPORT = /<meta\s+name=["']viewport["'][^>]*>/i;
/** Light-theme browser chrome colour. */
const THEME_LIGHT = '#f5f5f7';
/** Dark-theme browser chrome colour. */
const THEME_DARK = '#1c1c1e';
/**
 * Public URL of one generated icon.
 * @param size - icon edge length in pixels.
 * @returns the served path.
 */
export function iconPath(size) {
    return `${ICON_PREFIX}/icon-${String(size)}.png`;
}
/**
 * Absolute path of a packaged icon.
 * @param size - icon edge length in pixels.
 * @returns the on-disk path, valid from both `src/` and `lib/`.
 */
export function iconFile(size) {
    return fileURLToPath(new URL(`../assets/icon-${String(size)}.png`, import.meta.url));
}
/**
 * Read one packaged icon.
 * @param name - the basename from the request path.
 * @returns the PNG bytes, or undefined when the name is not a shipped icon.
 */
export async function readIcon(name) {
    const match = /^icon-(\d+)\.png$/.exec(name);
    if (match === null)
        return undefined;
    const size = Number(match[1]);
    if (!ICON_SIZES.includes(size))
        return undefined;
    try {
        return await readFile(iconFile(size));
    }
    catch {
        return undefined;
    }
}
/**
 * Add the iPad home-screen tags to a rendered index document.
 *
 * Idempotent: a document already carrying {@link MARKER} is returned verbatim.
 * @param html - the index document as rendered by the Harness webserver.
 * @returns the enhanced document.
 */
export function enhanceIndexHtml(html) {
    if (html.includes(MARKER))
        return html;
    const tags = [
        MARKER,
        '<meta name="apple-mobile-web-app-capable" content="yes" />',
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
        '<meta name="apple-mobile-web-app-title" content="DSH" />',
        `<link rel="apple-touch-icon" sizes="180x180" href="${iconPath(180)}" />`,
        `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_LIGHT}" />`,
        `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_DARK}" />`,
        // The portrait-touch layer, stylesheet half. Inlined rather than linked so
        // it arrives with the document: the layer is inert on desktop because every
        // rule sits behind its portrait/touch/width media query.
        `<style data-ipad-remote="mobile-adapt">${ADAPT_STYLE_MARKER}${adaptCss()}</style>`,
        // The offline shell, registered only on pages the gateway marked. Inert on the
        // desktop origin, where no mark is ever injected.
        `${REGISTRATION_MARKER}<script data-ipad-remote="service-worker">${renderRegistrationScript()}</script>`,
    ].join('\n    ');
    const withViewport = html.replace(VIEWPORT, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
    return injectScript(injectHead(withViewport, tags));
}
/**
 * Insert the injected tags just before the document's head end.
 * @param html - the document.
 * @param tags - markup to insert.
 * @returns the document, or the input when it carries no head.
 */
function injectHead(html, tags) {
    const headEnd = html.search(/<\/head>/i);
    if (headEnd < 0)
        return html;
    return `${html.slice(0, headEnd)}  ${tags}\n  ${html.slice(headEnd)}`;
}
/**
 * Insert the portrait-touch runtime just before the document's body end.
 *
 * \`defer\` keeps it off the critical path and guarantees the body exists when it
 * runs. A document without a body end is left alone: the stylesheet half still
 * applies, and the desktop page never needs the script at all.
 * @param html - the document.
 * @returns the document with the runtime inlined.
 */
function injectScript(html) {
    if (html.includes(ADAPT_SCRIPT_MARKER))
        return html;
    const bodyEnd = html.search(/<\/body>/i);
    if (bodyEnd < 0)
        return html;
    // Escape the closing tag so the inlined source cannot terminate its own
    // script element while the browser parses it.
    const source = adaptScript().replace(/<\/script/gi, '<\\/script');
    const tag = `${ADAPT_SCRIPT_MARKER}<script defer data-ipad-remote="mobile-adapt">${source}</script>\n`;
    return `${html.slice(0, bodyEnd)}${tag}${html.slice(bodyEnd)}`;
}
/**
 * The enhanced web app manifest.
 *
 * `display` becomes `standalone`: iOS honours that reliably, while upstream's
 * `fullscreen` is inconsistent there.
 * @returns the manifest JSON.
 */
export function renderManifest() {
    const manifest = {
        name: 'DeepSeek Harness',
        short_name: 'DSH',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: THEME_DARK,
        background_color: THEME_DARK,
        icons: ICON_SIZES.map(size => ({
            src: iconPath(size),
            sizes: `${String(size)}x${String(size)}`,
            type: 'image/png',
            purpose: 'any',
        })),
    };
    return `${JSON.stringify(manifest, null, 2)}\n`;
}
