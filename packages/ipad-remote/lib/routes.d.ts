/**
 * Small request/response helpers for the two HTTP surfaces.
 * @module @harlin97/dsh-ipad-remote/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Maximum accepted body size for a control or unlock request. */
export declare const MAX_BODY_BYTES: number;
/**
 * Read and parse a JSON or form-encoded request body.
 * @param req - the incoming request.
 * @returns the parsed fields.
 * @throws when the body is too large or not parseable.
 */
export declare function readBody(req: IncomingMessage): Promise<Record<string, unknown>>;
/**
 * Send a JSON response.
 * @param res - response to write.
 * @param status - HTTP status.
 * @param body - JSON-serializable body.
 */
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
/**
 * Send an HTML response.
 * @param res - response to write.
 * @param status - HTTP status.
 * @param html - document body.
 */
export declare function sendHtml(res: ServerResponse, status: number, html: string): void;
/**
 * Whether a state-changing request came from this very origin.
 *
 * A browser attaches `Origin` to cross-origin writes, so a mismatch is a
 * cross-site attempt. A missing `Origin` is a non-browser client (curl, the
 * Harness client), which is allowed — the control surface is additionally only
 * reachable on loopback.
 * @param req - the incoming request.
 * @returns true when the request may mutate state.
 */
export declare function sameOrigin(req: IncomingMessage): boolean;
/**
 * Extract a stable caller key for throttling.
 * @param req - the incoming request.
 * @returns the socket address, or `'unknown'`.
 */
export declare function callerKey(req: IncomingMessage): string;
/**
 * Send a binary response.
 * @param res - response to write.
 * @param status - HTTP status.
 * @param body - response bytes.
 * @param contentType - media type.
 * @param maxAgeSeconds - cache lifetime; 0 disables caching.
 * @param extra - additional headers, for responses that need more than the three
 *   every asset shares (the service worker's `Service-Worker-Allowed`).
 */
export declare function sendBytes(res: ServerResponse, status: number, body: Buffer, contentType: string, maxAgeSeconds?: number, extra?: Record<string, string>): void;
