/**
 * PIN verifier and failure throttle.
 *
 * The PIN is the only gate in front of a UI that can run shell commands, so the
 * verifier is scrypt (not a bare hash) and every comparison is constant-time.
 * @module @harlin97/dsh-ipad-remote/pin
 */
import { isValidPinFormat } from './contract.js';
export { isValidPinFormat };
/**
 * Derive a serialized verifier for a PIN.
 * @param pin - the PIN to hash; must satisfy {@link isValidPinFormat}.
 * @returns `scrypt$N$r$p$salt$key` with both blobs base64.
 * @throws when the PIN does not satisfy {@link isValidPinFormat}.
 */
export declare function hashPin(pin: string): Promise<string>;
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
export declare function verifyPin(pin: string, stored: string | null): Promise<boolean>;
/** Outcome of an admission check. */
export interface ThrottleDecision {
    allowed: boolean;
    /** Milliseconds the caller should wait before retrying; 0 when allowed. */
    retryAfterMs: number;
}
/**
 * Per-key failure throttle with exponential backoff.
 *
 * Used per client address so one attacker cannot lock out a legitimate device.
 */
export declare class PinThrottle {
    private readonly limit;
    private readonly windowMs;
    private readonly failures;
    /**
     * @param limit - consecutive failures tolerated before backoff starts.
     * @param windowMs - base backoff window, doubled per failure past the limit.
     */
    constructor(limit?: number, windowMs?: number);
    /**
     * Whether a key may attempt verification now.
     * @param key - client identity (address).
     * @param now - injectable clock for tests.
     * @returns the decision, with the remaining wait when blocked.
     */
    check(key: string, now?: number): ThrottleDecision;
    /**
     * Record a failed attempt and extend the key's backoff.
     * @param key - client identity.
     * @param now - injectable clock for tests.
     */
    recordFailure(key: string, now?: number): void;
    /**
     * Clear a key's failure record after a successful attempt.
     * @param key - client identity.
     */
    reset(key: string): void;
}
