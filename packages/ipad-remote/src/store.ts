/**
 * Versioned, atomically-written runtime state.
 *
 * A missing file is a fresh install and resolves to {@link DEFAULT_STATE}. A
 * present-but-unreadable file is never silently replaced: an unknown version or
 * malformed payload fails loudly with an actionable message, because quietly
 * resetting would discard the PIN verifier and silently reopen a gateway.
 * @module @harlin97/dsh-ipad-remote/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PIN_LENGTH } from './contract.js'

export { PIN_LENGTH }

/** Current on-disk schema version. */
export const STORE_VERSION = 1

/** Default gateway listen port. */
export const DEFAULT_PORT = 50070

/** Default browser-session lifetime in days. */
export const DEFAULT_SESSION_DAYS = 30

/** Default HTTPS listen port, beside the plain one. */
export const DEFAULT_TLS_PORT = 50071

/** Persisted runtime state. */
export interface StoredState {
  version: typeof STORE_VERSION
  /** Whether the gateway should be listening. */
  enabled: boolean
  /** Gateway listen port. */
  port: number
  /** Gateway-issued browser session lifetime in days. */
  sessionDays: number
  /**
   * HTTPS listen port. State files written before HTTPS existed carry no such
   * field, and a missing one means the default rather than an error: an upgrade
   * must never invalidate a stored PIN.
   */
  tlsPort: number
  /** scrypt verifier for the PIN, or null before one is set. */
  pinHash: string | null
}

/** State used before anything has been persisted. */
export const DEFAULT_STATE: StoredState = {
  version: STORE_VERSION,
  enabled: false,
  port: DEFAULT_PORT,
  sessionDays: DEFAULT_SESSION_DAYS,
  tlsPort: DEFAULT_TLS_PORT,
  pinHash: null,
}

/** Ports below this are privileged or conventionally reserved for the Host. */
const MIN_PORT = 1024

/**
 * Validate a persisted payload.
 * @param value - parsed JSON of unknown shape.
 * @returns the validated state.
 * @throws when the payload is not a well-formed state of a known version.
 */
function parseState(value: unknown): StoredState {
  if (typeof value !== 'object' || value === null) throw new Error('state is not an object')
  const record = value as Record<string, unknown>

  if (record['version'] !== STORE_VERSION) {
    throw new Error(`unsupported version ${JSON.stringify(record['version'])} (this build writes version ${String(STORE_VERSION)})`)
  }
  const enabled = record['enabled']
  const port = record['port'] as number
  const sessionDays = record['sessionDays'] as number
  if (typeof enabled !== 'boolean') throw new Error('field "enabled" is not a boolean')
  if (!Number.isSafeInteger(port) || port < MIN_PORT || port > 65_535) {
    throw new Error(`field "port" must be an integer in [${String(MIN_PORT)}, 65535]`)
  }
  if (!Number.isSafeInteger(sessionDays) || sessionDays < 1) throw new Error('field "sessionDays" must be a positive integer')

  const tlsPort = record['tlsPort'] ?? DEFAULT_TLS_PORT
  if (typeof tlsPort !== 'number' || !Number.isSafeInteger(tlsPort) || tlsPort < MIN_PORT || tlsPort > 65_535) {
    throw new Error(`field "tlsPort" must be an integer in [${String(MIN_PORT)}, 65535]`)
  }

  const pinHash = record['pinHash']
  if (pinHash !== null && typeof pinHash !== 'string') throw new Error('field "pinHash" must be a string or null')

  return { version: STORE_VERSION, enabled, port, tlsPort, sessionDays, pinHash: pinHash as string | null }
}

/** Owns the runtime state file. */
export class ConfigStore {
  /**
   * @param path - absolute path of the state file.
   */
  constructor(readonly path: string) {}

  /**
   * Read the state, treating absence as a fresh install.
   * @returns the persisted state, or {@link DEFAULT_STATE} when the file does not exist.
   * @throws when the file exists but cannot be read or parsed.
   */
  async load(): Promise<StoredState> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_STATE }
      throw new Error(`ipad-remote: cannot read state file ${this.path}: ${(error as Error).message}`, { cause: error })
    }
    try {
      return parseState(JSON.parse(text))
    } catch (error) {
      throw new Error(
        `ipad-remote: state file ${this.path} is not usable (${(error as Error).message}); it was left untouched — move it aside to start fresh`,
        { cause: error },
      )
    }
  }

  /**
   * Persist state atomically: write a sibling temp file, then rename over the
   * target, so a crash mid-write can never truncate the live file.
   * @param state - the complete next state.
   */
  async save(state: StoredState): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true })
    const temp = join(directory, `.config.json.tmp-${String(process.pid)}`)
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.path)
  }
}
