/**
 * Control-surface client used by the settings section.
 *
 * Every call goes to the loopback surface the Host registers on the Harness
 * webserver, so the browser is same-origin and \`sameOrigin()\` accepts the
 * writes. The fetch face is injectable so the section can be tested without a
 * network.
 * @module @harlin97/dsh-ipad-remote/client/api
 */
import { type RemoteStatus } from '../contract.js';
/** The subset of the Fetch API this client needs. */
export interface ControlFetchResponse {
    /** Whether the response carried a success status. */
    ok: boolean;
    /** HTTP status, used for the fallback message. */
    status: number;
    /** Parsed JSON body. */
    json(): Promise<unknown>;
}
/** Fetch-shaped function; `globalThis.fetch` satisfies it. */
export type ControlFetch = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<ControlFetchResponse>;
/** Every control operation the card can perform. */
export interface ControlApi {
    /** Read the current status. */
    status(): Promise<RemoteStatus>;
    /** Ask the gateway to listen (or stop listening). */
    setEnabled(enabled: boolean): Promise<RemoteStatus>;
    /** Replace the access PIN. */
    setPin(pin: string): Promise<RemoteStatus>;
    /** Revoke every issued browser session. */
    revoke(): Promise<RemoteStatus>;
}
/**
 * Extract a human-readable message from a thrown value.
 * @param error - anything thrown.
 * @returns the message, or a generic fallback.
 */
export declare function messageOf(error: unknown): string;
/**
 * Build a control client.
 * @param fetchImpl - fetch implementation; defaults to the global one.
 * @param prefix - control-surface prefix; defaults to the wire constant.
 * @returns the client.
 */
export declare function createControlApi(fetchImpl?: ControlFetch, prefix?: string): ControlApi;
