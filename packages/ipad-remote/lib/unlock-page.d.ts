/**
 * The device-facing unlock page.
 *
 * Deliberately standalone: it is served by the gateway before any Harness asset
 * has loaded, so it cannot use Harness design tokens or components. It stays
 * dependency-free (no external fonts, scripts or styles) so it renders on a
 * tablet on a network with no internet access.
 * @module @harlin97/dsh-ipad-remote/unlock-page
 */
/** Unlock page path. */
export declare const UNLOCK_PATH = "/__ipad-remote/unlock";
/** Unlock form submission path. */
export declare const UNLOCK_SUBMIT_PATH = "/__ipad-remote/unlock";
/** Logout path. */
export declare const LOGOUT_PATH = "/__ipad-remote/logout";
/**
 * Escape text for interpolation into HTML.
 * @param value - untrusted text.
 * @returns HTML-safe text.
 */
export declare function escapeHtml(value: string): string;
/** Inputs for one unlock page render. */
export interface UnlockPageInput {
    /** Human-readable failure to show, already localized. */
    error?: string;
    /** Seconds the client should wait before retrying. */
    retryAfterSeconds?: number;
}
/**
 * Render the unlock page.
 * @param input - optional error state.
 * @returns a complete HTML document.
 */
export declare function renderUnlockPage(input?: UnlockPageInput): string;
