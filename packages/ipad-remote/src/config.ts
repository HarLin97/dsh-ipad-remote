/**
 * Deployment-fixed plugin configuration.
 *
 * Runtime-mutable values (enabled / port / sessionDays / pinHash) deliberately
 * live in the store instead, so the settings card can change them without a
 * profile edit or a restart. See the design spec §5.9.
 * @module @harlin97/dsh-ipad-remote/config
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Raw config as written in a profile patch; every field is optional. */
export interface Config {
  /** Gateway listen host. Only the two upstream-supported values are accepted. */
  bindHost?: string
  /** Absolute path of the runtime state file. */
  storePath?: string
  /** Upper bound on concurrently live gateway sessions. */
  maxSessions?: number
}

/** Config with every default applied and every value validated. */
export interface ResolvedConfig {
  bindHost: string
  storePath: string
  maxSessions: number
}

/** Default loopback-or-all-interfaces posture, matching the upstream webserver. */
export const DEFAULT_BIND_HOST = '0.0.0.0'

/** Default concurrent-session ceiling. */
export const DEFAULT_MAX_SESSIONS = 32

/**
 * The Harness home directory this plugin persists under.
 * @param env - environment to read, defaulting to the process environment.
 * @returns the resolved `DSH_HOME`.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const declared = env['DSH_HOME']
  return declared !== undefined && declared.length > 0 ? resolve(declared) : join(homedir(), '.dsh')
}

/**
 * Apply defaults and validate a raw config object.
 *
 * This is a hand-written validator rather than a `@deepseek-ai/schemastery`
 * schema on purpose: schemastery is versioned independently of the dsh
 * packages (`3.18.5-alpha.1` in the live profile vs `3.18.4` on npm), so a peer
 * range would either exclude the runtime build or need an alpha-pinned range.
 * Three fields do not justify that coupling.
 * @param config - raw config from the profile patch, if any.
 * @param env - environment used to resolve the default store path.
 * @returns the resolved config.
 * @throws when a declared value is present but invalid.
 */
export function resolveConfig(config: Config | undefined, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const bindHost = config?.bindHost ?? DEFAULT_BIND_HOST
  if (bindHost !== '0.0.0.0' && bindHost !== '127.0.0.1') {
    throw new Error(
      `ipad-remote: bindHost must be "0.0.0.0" (network exposure) or "127.0.0.1" (loopback only), got ${JSON.stringify(bindHost)}`,
    )
  }

  const storePath = config?.storePath !== undefined
    ? resolve(config.storePath)
    : join(resolveHome(env), 'plugins', 'ipad-remote', 'config.json')

  const maxSessions = config?.maxSessions ?? DEFAULT_MAX_SESSIONS
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) {
    throw new Error(`ipad-remote: maxSessions must be a positive integer, got ${JSON.stringify(config?.maxSessions)}`)
  }

  return { bindHost, storePath, maxSessions }
}
