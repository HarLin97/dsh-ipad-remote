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
/** Path the gateway serves generated icons from. */
export declare const ICON_PREFIX = "/__ipad-remote/icons";
/** Manifest path the gateway intercepts and answers itself. */
export declare const MANIFEST_PATH = "/manifest.webmanifest";
/** Icon sizes shipped in `assets/`. */
export declare const ICON_SIZES: readonly [180, 192, 512];
/**
 * Public URL of one generated icon.
 * @param size - icon edge length in pixels.
 * @returns the served path.
 */
export declare function iconPath(size: number): string;
/**
 * Absolute path of a packaged icon.
 * @param size - icon edge length in pixels.
 * @returns the on-disk path, valid from both `src/` and `lib/`.
 */
export declare function iconFile(size: number): string;
/**
 * Read one packaged icon.
 * @param name - the basename from the request path.
 * @returns the PNG bytes, or undefined when the name is not a shipped icon.
 */
export declare function readIcon(name: string): Promise<Buffer | undefined>;
/**
 * Add the iPad home-screen tags to a rendered index document.
 *
 * Idempotent: a document already carrying {@link MARKER} is returned verbatim.
 * @param html - the index document as rendered by the Harness webserver.
 * @returns the enhanced document.
 */
export declare function enhanceIndexHtml(html: string): string;
/**
 * The enhanced web app manifest.
 *
 * `display` becomes `standalone`: iOS honours that reliably, while upstream's
 * `fullscreen` is inconsistent there.
 * @returns the manifest JSON.
 */
export declare function renderManifest(): string;
