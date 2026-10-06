/**
 * Gateway-issued browser sessions.
 *
 * This is the credential the iPad actually holds. The Harness process token and
 * its signed cookie never leave the host — the gateway keeps those to itself.
 * @module @harlin97/dsh-ipad-remote/session
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
/** Name of the gateway session cookie. */
export const SESSION_COOKIE = 'dsh_ipad_session';
/** Current payload version. */
const VERSION = 1;
/**
 * Sign and verify gateway session cookies, and track which are live.
 */
export class SessionAuthority {
    secret;
    maxSessions;
    now;
    generation = 0;
    live = new Map();
    /**
     * @param secret - per-process HMAC key; rotating it invalidates every cookie.
     * @param maxSessions - ceiling on concurrently live sessions; the oldest is evicted.
     * @param now - injectable clock for tests.
     */
    constructor(secret = randomBytes(32), maxSessions = 32, now = Date.now) {
        this.secret = secret;
        this.maxSessions = maxSessions;
        this.now = now;
    }
    /**
     * Issue a session for an authenticated device.
     * @param label - human label for the settings card.
     * @param ttlMs - lifetime in milliseconds.
     * @returns the cookie value and payload.
     */
    issue(label, ttlMs) {
        const issuedAt = this.now();
        const payload = {
            v: VERSION,
            sid: randomBytes(16).toString('base64url'),
            iat: issuedAt,
            exp: issuedAt + ttlMs,
            gen: this.generation,
            label,
        };
        this.evictIfFull();
        this.live.set(payload.sid, payload);
        return { cookie: this.encode(payload), payload };
    }
    /**
     * Verify a cookie and confirm its session is still live.
     * @param cookie - raw cookie value, or undefined when absent.
     * @returns the payload when authentic and live, otherwise undefined.
     */
    verify(cookie) {
        if (cookie === undefined || cookie.length === 0)
            return undefined;
        const separator = cookie.lastIndexOf('.');
        if (separator <= 0)
            return undefined;
        const body = cookie.slice(0, separator);
        const signature = cookie.slice(separator + 1);
        const expected = this.sign(body);
        const given = Buffer.from(signature, 'base64url');
        if (given.length !== expected.length || !timingSafeEqual(given, expected))
            return undefined;
        let payload;
        try {
            payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        }
        catch {
            return undefined;
        }
        if (payload.v !== VERSION || payload.gen !== this.generation)
            return undefined;
        if (typeof payload.exp !== 'number' || payload.exp <= this.now()) {
            this.live.delete(payload.sid);
            return undefined;
        }
        const known = this.live.get(payload.sid);
        if (known === undefined || known.exp !== payload.exp)
            return undefined;
        return payload;
    }
    /** Revoke every issued session by advancing the generation. */
    revokeAll() {
        this.generation += 1;
        this.live.clear();
    }
    /**
     * Sessions currently considered live.
     * @returns a snapshot, oldest first.
     */
    list() {
        const now = this.now();
        return [...this.live.values()].filter(entry => entry.exp > now).sort((a, b) => a.iat - b.iat);
    }
    /** Drop expired sessions before enforcing the ceiling. */
    evictIfFull() {
        const now = this.now();
        for (const [sid, entry] of this.live) {
            if (entry.exp <= now)
                this.live.delete(sid);
        }
        while (this.live.size >= this.maxSessions) {
            const oldest = this.list()[0];
            if (oldest === undefined)
                break;
            this.live.delete(oldest.sid);
        }
    }
    /**
     * Encode and sign a payload.
     * @param payload - the payload to encode.
     * @returns `base64url(payload).base64url(hmac)`.
     */
    encode(payload) {
        const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        return `${body}.${this.sign(body).toString('base64url')}`;
    }
    /**
     * Compute the HMAC over an encoded body.
     * @param body - base64url payload.
     * @returns the raw signature.
     */
    sign(body) {
        return createHmac('sha256', this.secret).update(body).digest();
    }
}
