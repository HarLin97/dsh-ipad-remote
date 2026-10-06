/**
 * PIN verifier and failure throttle.
 *
 * The PIN is the only gate in front of a UI that can run shell commands, so the
 * verifier is scrypt (not a bare hash) and every comparison is constant-time.
 * @module @harlin97/dsh-ipad-remote/pin
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PIN_LENGTH, isValidPinFormat } from './contract.js';
export { isValidPinFormat };
const scrypt = promisify(scryptCallback);
/** scrypt cost parameters. N=16384 keeps verification near ~50ms on typical hardware. */
const PARAMS = { N: 16_384, r: 8, p: 1 };
/** Derived key length in bytes. */
const KEY_BYTES = 32;
/** Salt length in bytes. */
const SALT_BYTES = 16;
/** Marker identifying the serialized verifier format. */
const SCHEME = 'scrypt';
/**
 * Derive a serialized verifier for a PIN.
 * @param pin - the PIN to hash; must satisfy {@link isValidPinFormat}.
 * @returns `scrypt$N$r$p$salt$key` with both blobs base64.
 * @throws when the PIN does not satisfy {@link isValidPinFormat}.
 */
export async function hashPin(pin) {
    if (!isValidPinFormat(pin))
        throw new Error(`ipad-remote: PIN must be exactly ${String(PIN_LENGTH)} digits`);
    const salt = randomBytes(SALT_BYTES);
    const key = await scrypt(pin, salt, KEY_BYTES, PARAMS);
    return [SCHEME, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}
/**
 * Decode a stored verifier.
 * @param stored - serialized verifier.
 * @returns the salt and expected key, or undefined when the string is malformed.
 */
function decode(stored) {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== SCHEME)
        return undefined;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (n !== PARAMS.N || r !== PARAMS.r || p !== PARAMS.p)
        return undefined;
    try {
        return { salt: Buffer.from(parts[4] ?? '', 'base64'), key: Buffer.from(parts[5] ?? '', 'base64') };
    }
    catch {
        return undefined;
    }
}
/**
 * Verify a candidate PIN against a stored verifier.
 *
 * A malformed candidate or malformed verifier still performs one scrypt
 * derivation before returning false, so response time does not distinguish
 * "wrong shape" from "wrong PIN".
 * @param pin - candidate PIN.
 * @param stored - serialized verifier, or null when no PIN is set.
 * @returns true only on an exact, constant-time match.
 */
export async function verifyPin(pin, stored) {
    if (stored === null) {
        // No PIN configured: burn equivalent time, then refuse.
        await scrypt(pin, Buffer.alloc(SALT_BYTES), KEY_BYTES, PARAMS);
        return false;
    }
    const verifier = decode(stored);
    if (verifier === undefined || verifier.key.length !== KEY_BYTES) {
        await scrypt(pin, Buffer.alloc(SALT_BYTES), KEY_BYTES, PARAMS);
        return false;
    }
    const candidate = await scrypt(pin, verifier.salt, KEY_BYTES, PARAMS);
    return timingSafeEqual(candidate, verifier.key);
}
/**
 * Per-key failure throttle with exponential backoff.
 *
 * Used per client address so one attacker cannot lock out a legitimate device.
 */
export class PinThrottle {
    limit;
    windowMs;
    failures = new Map();
    /**
     * @param limit - consecutive failures tolerated before backoff starts.
     * @param windowMs - base backoff window, doubled per failure past the limit.
     */
    constructor(limit = 5, windowMs = 15 * 60 * 1000) {
        this.limit = limit;
        this.windowMs = windowMs;
    }
    /**
     * Whether a key may attempt verification now.
     * @param key - client identity (address).
     * @param now - injectable clock for tests.
     * @returns the decision, with the remaining wait when blocked.
     */
    check(key, now = Date.now()) {
        const entry = this.failures.get(key);
        if (entry === undefined || entry.blockedUntil <= now)
            return { allowed: true, retryAfterMs: 0 };
        return { allowed: false, retryAfterMs: entry.blockedUntil - now };
    }
    /**
     * Record a failed attempt and extend the key's backoff.
     * @param key - client identity.
     * @param now - injectable clock for tests.
     */
    recordFailure(key, now = Date.now()) {
        const entry = this.failures.get(key) ?? { count: 0, blockedUntil: 0 };
        entry.count += 1;
        if (entry.count >= this.limit) {
            const excess = entry.count - this.limit;
            entry.blockedUntil = now + this.windowMs * 2 ** Math.min(excess, 10);
        }
        this.failures.set(key, entry);
    }
    /**
     * Clear a key's failure record after a successful attempt.
     * @param key - client identity.
     */
    reset(key) {
        this.failures.delete(key);
    }
}
