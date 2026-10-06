/**
 * Mint and hold the Harness browser session the gateway reuses.
 *
 * The iPad must never see this credential. The gateway exchanges the process
 * token for a signed cookie once, keeps it in memory, and injects it into every
 * upstream request. See the design spec §5.4.
 * @module @harlin97/dsh-ipad-remote/inner-session
 */

import { request as httpRequest } from 'node:http'

/** Where the Harness webserver listens. */
export interface InnerTarget {
  host: string
  port: number
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
export async function exchangeForCookie(tokenUrl: string, target: InnerTarget): Promise<string | undefined> {
  const url = new URL(tokenUrl)
  const authority = `${target.host}:${String(target.port)}`
  return await new Promise<string | undefined>((resolve, reject) => {
    const req = httpRequest({
      host: target.host,
      port: target.port,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: { host: authority, accept: 'text/html', connection: 'close' },
    }, response => {
      const cookies = response.headers['set-cookie'] ?? []
      response.resume()
      const pair = cookies.map(entry => entry.split(';')[0]).filter(part => part !== undefined && part.length > 0).join('; ')
      resolve(pair.length > 0 ? pair : undefined)
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Caches the harvested cookie and re-mints it after an upstream 401.
 */
export class InnerSession {
  private cookie: string | undefined
  private pending: Promise<string | undefined> | undefined

  /**
   * @param mint - performs one token exchange; normally closes over
   *   `ctx.connection.authenticatedUrl()` and {@link exchangeForCookie}.
   */
  constructor(private readonly mint: () => Promise<string | undefined>) {}

  /**
   * The cookie pair to inject upstream, minting it on first use.
   * @returns the cookie pair, or undefined when minting failed.
   */
  async cookies(): Promise<string | undefined> {
    if (this.cookie !== undefined) return this.cookie
    this.pending ??= this.mint()
      .then((value) => {
        if (value !== undefined) this.cookie = value
        return value
      })
      .finally(() => { this.pending = undefined })
    return await this.pending
  }

  /** Drop the cached cookie so the next request re-mints it. */
  invalidate(): void {
    this.cookie = undefined
  }

  /** Whether a cookie is currently held, without minting one. */
  get held(): boolean {
    return this.cookie !== undefined
  }
}
