/**
 * dsh-ipad-remote — let an iPad reach this Harness over the LAN or a Tailscale
 * tailnet, behind a self-hosted PIN gate, while the Harness webserver itself
 * stays on loopback.
 *
 * See ../../docs/superpowers/specs/2026-10-04-ipad-remote-design.md.
 * @module @harlin97/dsh-ipad-remote
 */

// Type-only imports so the Context augmentations for `webServer` and
// `connection` are in scope without pulling runtime code into this module.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig, type Config } from './config.js'
import { CONTROL_PREFIX } from './contract.js'
import { enhanceIndexHtml } from './pwa.js'
import { RemoteAccess, type RemoteAccessHost } from './remote-access.js'

/** Stable Cordis plugin name. */
export const name = 'ipad-remote'

/** The gateway cannot work without something to listen on and something to proxy to. */
export const inject = ['webServer', 'connection']

/**
 * Adapt the Cordis context to the narrow port the state machine consumes.
 * @param ctx - owning plugin context.
 * @returns the host adapter.
 */
function hostOf(ctx: Context): RemoteAccessHost {
  return {
    webServerPort: () => ctx.webServer.port,
    authenticatedUrl: baseUrl => ctx.connection.authenticatedUrl(baseUrl),
    log: (level, message) => {
      const prefixed = `ipad-remote: ${message}`
      if (level === 'warn') ctx.logger.warn(prefixed)
      else ctx.logger.info(prefixed)
    },
  }
}

/**
 * Mount the iPad remote gateway.
 * @param ctx - owning plugin context.
 * @param config - deployment-fixed configuration from the profile patch.
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = resolveConfig(config)
  const access = new RemoteAccess(hostOf(ctx), resolved)

  // Loopback control surface for the settings card. Registered on the Harness
  // webserver (not the gateway) because the card runs inside the Harness UI.
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: CONTROL_PREFIX,
      handler: (req, res) => { void access.handleControl(req, res) },
    }),
    'ipad-remote: control routes',
  )

  // Public index-transform hook: adds the iPad home-screen tags to every
  // rendered index. Idempotent, and inert on desktop browsers. The manifest and
  // icons are served by the gateway instead, so desktop behaviour is unchanged.
  ctx.effect(
    () => ctx.webServer.tapIndex(enhanceIndexHtml),
    'ipad-remote: pwa index tags',
  )

  // Gateway lifecycle. Starting is deferred so a bad state file or an occupied
  // port cannot abort plugin load and take the whole Harness boot down with it.
  ctx.effect(() => {
    void access.start()
    return () => { void access.dispose() }
  }, 'ipad-remote: gateway')
}
