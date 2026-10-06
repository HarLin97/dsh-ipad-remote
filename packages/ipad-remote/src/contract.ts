/**
 * Wire contract shared by the Host half and the Browser half.
 *
 * Contains only pure types and stable protocol constants — no runtime imports
 * from either side, so the Browser bundle never pulls in Node code.
 * @module @harlin97/dsh-ipad-remote/contract
 */

/** Carrier family an address belongs to. */
export type Transport = 'lan' | 'tailscale'

/** Loopback control surface used by the Harness settings card. */
export const CONTROL_PREFIX = '/ipad-remote/api'

/** Device-facing surface owned by the gateway on the network-facing port. */
export const DEVICE_PREFIX = '/__ipad-remote'

/** Accepted PIN length, in digits. Canonical here so both halves enforce one rule. */
export const PIN_LENGTH = 6

/**
 * Whether a candidate PIN has the accepted shape (exactly {@link PIN_LENGTH} digits).
 *
 * The Host enforces this on every write; the settings card validates with the
 * same function so the user sees the error before a round trip.
 * @param pin - candidate.
 * @returns true when the PIN is well-formed.
 */
export function isValidPinFormat(pin: string): boolean {
  return new RegExp(`^[0-9]{${String(PIN_LENGTH)}}$`).test(pin)
}

/** One address an iPad could open. */
export interface AddressEntry {
  /** IPv4 literal. */
  address: string
  /** Interface the address belongs to. */
  iface: string
  /** Carrier family. */
  transport: Transport
  /** Localized group label. */
  label: string
  /** URL to open, or to encode as a QR code. */
  url: string
}

/** One live gateway session. */
export interface SessionEntry {
  /** Label captured at issue time. */
  label: string
  /** ISO-8601 issue time. */
  issuedAt: string
  /** ISO-8601 expiry. */
  expiresAt: string
}

/**
 * HTTPS listener state.
 *
 * Android and desktop Chrome only install a PWA from a secure origin, so this is
 * what turns "add to home screen" into a real app on those devices — and what
 * explains, in the card, why it is not available yet.
 */
export interface TlsStatus {
  /** Whether a certificate pair was found and parsed. */
  enabled: boolean
  /** Whether the HTTPS listener is actually up. */
  listening: boolean
  /** Configured HTTPS port. */
  port: number
  /** Certificate expiry as ISO-8601. */
  expiresAt?: string
  /** Certificate SANs, for diagnosing an address change. */
  subjectAltName?: string
  /** Why HTTPS is not up, when it is not. */
  error?: string
  /** Reachable addresses the certificate does not cover. */
  uncoveredAddresses: string[]
}

/** Everything the settings card renders. */
export interface RemoteStatus {
  /** Whether the gateway is configured to listen. */
  enabled: boolean
  /** Whether the listener is actually up. */
  listening: boolean
  /** Configured listen port. */
  port: number
  /** Configured listen host. */
  bindHost: string
  /** Whether a PIN has been set. */
  hasPin: boolean
  /**
   * The PIN as set during THIS process run, when there has been one.
   *
   * Only the scrypt verifier is persisted, so a PIN from an earlier run cannot
   * be recovered; absent here means "set, but not recoverable without setting it
   * again". Held in memory on purpose: a leaked state file must not hand over
   * the PIN itself.
   */
  currentPin?: string
  /** HTTPS listener state. */
  tls: TlsStatus
  /** Addresses an iPad can use, grouped by transport. */
  addresses: AddressEntry[]
  /** Currently live sessions. */
  sessions: SessionEntry[]
  /** Absolute path of the persisted state file, for troubleshooting. */
  storePath: string
}

/** Uniform control-plane error body. */
export interface ControlError {
  error: string
}

/** Every control route answers one of these. */
export type ControlResponse = RemoteStatus | ControlError | { ok: true }
