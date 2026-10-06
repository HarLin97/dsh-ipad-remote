/**
 * The network-facing gateway.
 *
 * Responsibilities, in order: own its control routes, enforce the PIN-issued
 * session, then reverse-proxy HTTP and WebSocket upgrades to the loopback
 * Harness webserver. Request bodies and responses are streamed, never buffered,
 * because the Harness client multiplexes long-lived streams over `/api`.
 *
 * Two header rewrites are load-bearing and deliberate:
 * - `Host`/`Origin` become the loopback authority so the Harness trust fence
 *   admits the request. That fence is explicitly not an auth layer (see the
 *   design spec §4 F3); the PIN session is what authenticates the client.
 * - The browser's `Cookie` is dropped and replaced by the gateway's own inner
 *   cookie, so the Harness credential never reaches the iPad.
 * @module @harlin97/dsh-ipad-remote/gateway
 */
import { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type Server as SecureServer } from 'node:https';
import type { TlsMaterial } from './tls.js';
import { type SessionAuthority } from './session.js';
import type { InnerTarget } from './inner-session.js';
/**
 * Either listener flavour. Both expose the same lifecycle surface, which is all
 * this module uses, so HTTPS costs one branch at creation and nothing else.
 */
export type GatewayListener = Server | SecureServer;
/** Gateway log sink. */
export type GatewayLog = (level: 'info' | 'warn', message: string) => void;
/** Routes the gateway answers itself instead of proxying. */
export interface GatewayControl {
    /** Absolute path prefix this handler owns. */
    prefix: string;
    /**
     * Answer one control request.
     * @returns true when the response was written, false to fall through.
     */
    handle: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;
}
/** Construction options. */
export interface GatewayOptions {
    /** Listen host — normally `0.0.0.0`. */
    bindHost: string;
    /** Listen port; 0 asks the OS for a free one. */
    port: number;
    /**
     * Certificate pair. When present the listener speaks HTTPS, which is what
     * Android and desktop Chrome require before they will install the page.
     */
    tls?: TlsMaterial;
    /** Loopback Harness webserver to proxy to. */
    target: InnerTarget;
    /** Issues and verifies the iPad-facing sessions. */
    sessions: SessionAuthority;
    /** Optional self-owned routes (unlock page, control API). */
    control?: GatewayControl;
    /** Headers injected into every upstream request; supplies the inner cookie. */
    upstreamHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
    /** Log sink; defaults to silence so tests stay quiet. */
    log?: GatewayLog;
}
/**
 * Read one cookie from a `Cookie` header.
 * @param header - raw header value.
 * @param name - cookie name to find.
 * @returns the decoded value, or undefined.
 */
export declare function readCookie(header: string | undefined, name: string): string | undefined;
/**
 * Serialize a session cookie for `Set-Cookie`.
 * @param value - cookie value.
 * @param maxAgeSeconds - lifetime.
 * @param secure - whether to add the `Secure` attribute.
 * @returns the header value.
 */
export declare function sessionSetCookie(value: string, maxAgeSeconds: number, secure: boolean): string;
/** Clear-cookie header for logout. */
export declare function sessionClearCookie(): string;
/**
 * Mark one proxied document as gateway-served.
 *
 * The client half registers its service worker only when this mark is present, so
 * the desktop window — which shares a machine, and often a cookie jar, with the
 * gateway — never gains a worker that could serve it stale assets.
 * @param html - the document as the Harness rendered it.
 * @returns the document carrying the marker script.
 */
export declare function injectGatewayMarker(html: string): string;
/**
 * Reverse proxy in front of the loopback Harness webserver.
 */
export declare class Gateway {
    private readonly options;
    private server;
    private boundPort;
    private readonly sockets;
    /**
     * Sockets with a request whose response has not gone out yet. They survive
     * {@link stop} until that answer leaves, because the request that turns
     * remote access off travels on one of them.
     */
    private readonly busy;
    /** Whether {@link stop} has begun; a finished answer releases its socket. */
    private stopping;
    /**
     * @param options - listen, target and session wiring.
     */
    constructor(options: GatewayOptions);
    /** Actual listening port; 0 before {@link start}. */
    get port(): number;
    /** Whether the listener is up. */
    get listening(): boolean;
    /** Transport this listener speaks, for logs and errors. */
    private get scheme();
    /**
     * Start listening.
     * @returns the bound port.
     * @throws when the bind fails, naming the address and the reason.
     */
    start(): Promise<number>;
    /**
     * Stop listening and tear down every connection, including upgraded sockets,
     * which `closeAllConnections()` does not cover.
     *
     * A socket that is still answering keeps its answer: the settings card can be
     * reached through the gateway (that is how an iPad sees it), so the response
     * that reports "remote access is off" travels on a socket this method is
     * about to close. Idle and upgraded sockets — every live device tunnel — go
     * immediately; a busy one goes the moment its response has left.
     */
    stop(): Promise<void>;
    /** Route one request: control, then auth, then proxy. */
    private onRequest;
    /**
     * Answer an unauthenticated request: a document navigation is sent to the
     * unlock page, an API call gets a flat 401 so the client can surface it.
     */
    private refuse;
    /** Stream a request to the upstream webserver and stream the answer back. */
    private forward;
    /** Proxy one WebSocket upgrade, preserving the raw handshake. */
    private onUpgrade;
    /**
     * Build the upstream header set: loopback authority, no browser cookie, and
     * whatever `upstreamHeaders` supplies (the inner Harness cookie).
     *
     * Dropping `cookie` is what keeps the Harness credential on this side of the
     * gateway; rewriting `host`/`origin` is what lets the Harness trust fence
     * admit the request as a loopback one.
     */
    private buildUpstreamHeaders;
    private track;
    private log;
}
