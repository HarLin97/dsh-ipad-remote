/**
 * The iPad-remote state machine: owns persisted state, the gateway lifecycle,
 * and both HTTP surfaces (loopback control, network-facing device).
 * @module @harlin97/dsh-ipad-remote/remote-access
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type RemoteStatus } from './contract.js';
import type { ResolvedConfig } from './config.js';
import { readCookie } from './gateway.js';
import { SESSION_COOKIE } from './session.js';
/**
 * What the state machine needs from its host. Kept narrow so the state machine
 * can be exercised without booting a Cordis tree.
 */
export interface RemoteAccessHost {
    /** Port the Harness webserver is listening on. */
    webServerPort: () => number;
    /** Attach this process's launch token to a clean application URL. */
    authenticatedUrl: (baseUrl: string) => string;
    /** Emit one plugin-prefixed log line. */
    log: (level: 'info' | 'warn', message: string) => void;
}
/**
 * Owns everything the plugin mounted, so mounting twice or disposing twice is safe.
 */
export declare class RemoteAccess {
    private readonly host;
    private readonly config;
    private state;
    private loaded;
    private gateway;
    private secure;
    private tlsReport;
    /**
     * The PIN set during this process run, if any.
     *
     * Deliberately memory-only: the state file keeps a scrypt verifier and never
     * the PIN, so this dies with the process and a restart simply reports that the
     * value is no longer recoverable.
     */
    private currentPin;
    private readonly sessions;
    private readonly throttle;
    private readonly inner;
    private readonly store;
    /**
     * @param host - adapter over the Cordis services this plugin needs.
     * @param config - resolved deployment config.
     */
    constructor(host: RemoteAccessHost, config: ResolvedConfig);
    /** Port the Harness webserver listens on. */
    private harnessPort;
    /** Load persisted state once. */
    private ensureLoaded;
    /** Start the gateway when the persisted state says it should be up. */
    start(): Promise<void>;
    /** Stop both listeners and release every resource. Safe to call repeatedly. */
    dispose(): Promise<void>;
    /** Stop the plain and the secure listener, whichever are up. */
    private stopListeners;
    /** Current status for the settings card. */
    status(): RemoteStatus;
    /**
     * HTTPS state for the card.
     *
     * `enabled` answers "was a usable pair found", `listening` answers "is it up",
     * and the uncovered addresses answer "will my device actually connect" — the
     * question a stale certificate raises, because a home-screen icon bakes in the
     * origin it was installed from.
     * @param addresses - the addresses already computed for this report.
     * @returns the TLS slice of the status.
     */
    private tlsStatus;
    /**
     * Bring the listener up or down.
     * @param enabled - desired state.
     * @throws when enabling without a PIN, or when the port cannot be bound.
     */
    private applyEnabled;
    /**
     * Persist and apply a new enabled flag. State is only recorded once the
     * listener actually came up, so a failed bind does not leave a state file
     * claiming the gateway is running.
     * @param enabled - desired state.
     */
    setEnabled(enabled: boolean): Promise<void>;
    /**
     * Replace the PIN. Existing sessions are deliberately left alive; the card
     * offers an explicit revoke for that (design spec §8 limitation 2).
     * @param pin - the new PIN.
     */
    setPin(pin: string): Promise<void>;
    /**
     * Persist "not enabled" and release the listener once `res` is flushed.
     *
     * The settings card can be reached *through* the gateway — that is exactly
     * how an iPad sees it — so this answer travels on one of the device sockets
     * that {@link Gateway.stop} destroys. Stopping first would kill the response
     * and the card would report a failure for a change that did happen; the state
     * flips immediately instead, and the socket is released after the bytes leave.
     * @param res - response carrying the new status.
     */
    private disableAfterAnswering;
    /** Revoke every issued session. */
    revokeAll(): Promise<void>;
    /** Persist state atomically. */
    private persist;
    /** Tear down the listener across reloads, then rebuild it from fresh state. */
    reload(): Promise<void>;
    /**
     * Answer a loopback control request.
     * @param req - incoming request.
     * @param res - response to write.
     */
    handleControl(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /**
     * Answer a device-facing request the gateway owns.
     * @param req - incoming request.
     * @param res - response to write.
     * @returns true when this answered; false lets the gateway fall through.
     */
    handleDevice(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
    /** Verify a submitted PIN and establish the device session. */
    private submitPin;
    private log;
}
/** Re-exported so callers do not need the gateway module. */
export { readCookie, SESSION_COOKIE };
