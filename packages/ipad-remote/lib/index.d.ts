/**
 * dsh-ipad-remote — let an iPad reach this Harness over the LAN or a Tailscale
 * tailnet, behind a self-hosted PIN gate, while the Harness webserver itself
 * stays on loopback.
 *
 * See ../../docs/superpowers/specs/2026-10-04-ipad-remote-design.md.
 * @module @harlin97/dsh-ipad-remote
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Config } from './config.js';
/** Stable Cordis plugin name. */
export declare const name = "ipad-remote";
/** The gateway cannot work without something to listen on and something to proxy to. */
export declare const inject: string[];
/**
 * Mount the iPad remote gateway.
 * @param ctx - owning plugin context.
 * @param config - deployment-fixed configuration from the profile patch.
 */
export declare function apply(ctx: Context, config?: Config): void;
