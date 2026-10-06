/**
 * Versioned, atomically-written runtime state.
 *
 * A missing file is a fresh install and resolves to {@link DEFAULT_STATE}. A
 * present-but-unreadable file is never silently replaced: an unknown version or
 * malformed payload fails loudly with an actionable message, because quietly
 * resetting would discard the PIN verifier and silently reopen a gateway.
 * @module @harlin97/dsh-ipad-remote/store
 */
import { PIN_LENGTH } from './contract.js';
export { PIN_LENGTH };
/** Current on-disk schema version. */
export declare const STORE_VERSION = 1;
/** Default gateway listen port. */
export declare const DEFAULT_PORT = 50070;
/** Default browser-session lifetime in days. */
export declare const DEFAULT_SESSION_DAYS = 30;
/** Default HTTPS listen port, beside the plain one. */
export declare const DEFAULT_TLS_PORT = 50071;
/** Persisted runtime state. */
export interface StoredState {
    version: typeof STORE_VERSION;
    /** Whether the gateway should be listening. */
    enabled: boolean;
    /** Gateway listen port. */
    port: number;
    /** Gateway-issued browser session lifetime in days. */
    sessionDays: number;
    /**
     * HTTPS listen port. State files written before HTTPS existed carry no such
     * field, and a missing one means the default rather than an error: an upgrade
     * must never invalidate a stored PIN.
     */
    tlsPort: number;
    /** scrypt verifier for the PIN, or null before one is set. */
    pinHash: string | null;
}
/** State used before anything has been persisted. */
export declare const DEFAULT_STATE: StoredState;
/** Owns the runtime state file. */
export declare class ConfigStore {
    readonly path: string;
    /**
     * @param path - absolute path of the state file.
     */
    constructor(path: string);
    /**
     * Read the state, treating absence as a fresh install.
     * @returns the persisted state, or {@link DEFAULT_STATE} when the file does not exist.
     * @throws when the file exists but cannot be read or parsed.
     */
    load(): Promise<StoredState>;
    /**
     * Persist state atomically: write a sibling temp file, then rename over the
     * target, so a crash mid-write can never truncate the live file.
     * @param state - the complete next state.
     */
    save(state: StoredState): Promise<void>;
}
