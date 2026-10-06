/**
 * Gateway-issued browser sessions.
 *
 * This is the credential the iPad actually holds. The Harness process token and
 * its signed cookie never leave the host — the gateway keeps those to itself.
 * @module @harlin97/dsh-ipad-remote/session
 */
/** Payload carried by a gateway session cookie. */
export interface SessionPayload {
    /** Payload version, so the format can evolve. */
    v: 1;
    /** Random session id. */
    sid: string;
    /** Issued-at, epoch milliseconds. */
    iat: number;
    /** Expiry, epoch milliseconds. */
    exp: number;
    /** Revocation generation; a mismatch invalidates the cookie. */
    gen: number;
    /** Human label shown in the settings card. */
    label: string;
}
/** A freshly issued cookie and the payload it encodes. */
export interface IssuedSession {
    /** Value for the `Set-Cookie` header. */
    cookie: string;
    payload: SessionPayload;
}
/** Name of the gateway session cookie. */
export declare const SESSION_COOKIE = "dsh_ipad_session";
/**
 * Sign and verify gateway session cookies, and track which are live.
 */
export declare class SessionAuthority {
    private readonly secret;
    private readonly maxSessions;
    private readonly now;
    private generation;
    private readonly live;
    /**
     * @param secret - per-process HMAC key; rotating it invalidates every cookie.
     * @param maxSessions - ceiling on concurrently live sessions; the oldest is evicted.
     * @param now - injectable clock for tests.
     */
    constructor(secret?: Buffer, maxSessions?: number, now?: () => number);
    /**
     * Issue a session for an authenticated device.
     * @param label - human label for the settings card.
     * @param ttlMs - lifetime in milliseconds.
     * @returns the cookie value and payload.
     */
    issue(label: string, ttlMs: number): IssuedSession;
    /**
     * Verify a cookie and confirm its session is still live.
     * @param cookie - raw cookie value, or undefined when absent.
     * @returns the payload when authentic and live, otherwise undefined.
     */
    verify(cookie: string | undefined): SessionPayload | undefined;
    /** Revoke every issued session by advancing the generation. */
    revokeAll(): void;
    /**
     * Sessions currently considered live.
     * @returns a snapshot, oldest first.
     */
    list(): SessionPayload[];
    /** Drop expired sessions before enforcing the ceiling. */
    private evictIfFull;
    /**
     * Encode and sign a payload.
     * @param payload - the payload to encode.
     * @returns `base64url(payload).base64url(hmac)`.
     */
    private encode;
    /**
     * Compute the HMAC over an encoded body.
     * @param body - base64url payload.
     * @returns the raw signature.
     */
    private sign;
}
