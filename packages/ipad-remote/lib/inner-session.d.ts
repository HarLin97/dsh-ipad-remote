/**
 * Mint and hold the Harness browser session the gateway reuses.
 *
 * The iPad must never see this credential. The gateway exchanges the process
 * token for a signed cookie once, keeps it in memory, and injects it into every
 * upstream request. See the design spec §5.4.
 * @module @harlin97/dsh-ipad-remote/inner-session
 */
/** Where the Harness webserver listens. */
export interface InnerTarget {
    host: string;
    port: number;
}
/**
 * Perform the Harness token exchange and return the resulting cookie pair.
 *
 * `node:http` is used rather than `fetch` because undici forbids setting the
 * `Host` header, and the Harness trust fence keys on it: the request must look
 * like a loopback request for the fence to admit it.
 * @param tokenUrl - tokenized root URL from `ctx.connection.authenticatedUrl()`.
 * @param target - loopback Harness webserver address.
 * @returns the `name=value` cookie pair, or undefined when the exchange failed.
 */
export declare function exchangeForCookie(tokenUrl: string, target: InnerTarget): Promise<string | undefined>;
/**
 * Caches the harvested cookie and re-mints it after an upstream 401.
 */
export declare class InnerSession {
    private readonly mint;
    private cookie;
    private pending;
    /**
     * @param mint - performs one token exchange; normally closes over
     *   `ctx.connection.authenticatedUrl()` and {@link exchangeForCookie}.
     */
    constructor(mint: () => Promise<string | undefined>);
    /**
     * The cookie pair to inject upstream, minting it on first use.
     * @returns the cookie pair, or undefined when minting failed.
     */
    cookies(): Promise<string | undefined>;
    /** Drop the cached cookie so the next request re-mints it. */
    invalidate(): void;
    /** Whether a cookie is currently held, without minting one. */
    get held(): boolean;
}
