/**
 * Deployment-fixed plugin configuration.
 *
 * Runtime-mutable values (enabled / port / sessionDays / pinHash) deliberately
 * live in the store instead, so the settings card can change them without a
 * profile edit or a restart. See the design spec §5.9.
 * @module @harlin97/dsh-ipad-remote/config
 */
/** Raw config as written in a profile patch; every field is optional. */
export interface Config {
    /** Gateway listen host. Only the two upstream-supported values are accepted. */
    bindHost?: string;
    /** Absolute path of the runtime state file. */
    storePath?: string;
    /** Upper bound on concurrently live gateway sessions. */
    maxSessions?: number;
}
/** Config with every default applied and every value validated. */
export interface ResolvedConfig {
    bindHost: string;
    storePath: string;
    maxSessions: number;
}
/** Default loopback-or-all-interfaces posture, matching the upstream webserver. */
export declare const DEFAULT_BIND_HOST = "0.0.0.0";
/** Default concurrent-session ceiling. */
export declare const DEFAULT_MAX_SESSIONS = 32;
/**
 * The Harness home directory this plugin persists under.
 * @param env - environment to read, defaulting to the process environment.
 * @returns the resolved `DSH_HOME`.
 */
export declare function resolveHome(env?: NodeJS.ProcessEnv): string;
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
export declare function resolveConfig(config: Config | undefined, env?: NodeJS.ProcessEnv): ResolvedConfig;
