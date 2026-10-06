/**
 * Small request/response helpers for the two HTTP surfaces.
 * @module @harlin97/dsh-ipad-remote/routes
 */
/** Maximum accepted body size for a control or unlock request. */
export const MAX_BODY_BYTES = 8 * 1024;
/**
 * Read and parse a JSON or form-encoded request body.
 * @param req - the incoming request.
 * @returns the parsed fields.
 * @throws when the body is too large or not parseable.
 */
export async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        size += buffer.length;
        if (size > MAX_BODY_BYTES)
            throw new Error('request body is too large');
        chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.length === 0)
        return {};
    const type = req.headers['content-type'] ?? '';
    if (type.includes('application/json'))
        return JSON.parse(text);
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
}
/**
 * Send a JSON response.
 * @param res - response to write.
 * @param status - HTTP status.
 * @param body - JSON-serializable body.
 */
export function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(text)),
        'cache-control': 'no-store',
    });
    res.end(text);
}
/**
 * Send an HTML response.
 * @param res - response to write.
 * @param status - HTTP status.
 * @param html - document body.
 */
export function sendHtml(res, status, html) {
    res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(html)),
        'cache-control': 'no-store',
    });
    res.end(html);
}
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
export function sameOrigin(req) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin === undefined)
        return true;
    if (host === undefined)
        return false;
    try {
        return new URL(origin).host === host;
    }
    catch {
        return false;
    }
}
/**
 * Extract a stable caller key for throttling.
 * @param req - the incoming request.
 * @returns the socket address, or `'unknown'`.
 */
export function callerKey(req) {
    return req.socket.remoteAddress ?? 'unknown';
}
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
export function sendBytes(res, status, body, contentType, maxAgeSeconds = 0, extra = {}) {
    res.writeHead(status, {
        ...extra,
        'content-type': contentType,
        'content-length': String(body.length),
        'cache-control': maxAgeSeconds > 0 ? `public, max-age=${String(maxAgeSeconds)}` : 'no-store',
    });
    res.end(body);
}
