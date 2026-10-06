/**
 * Wire contract shared by the Host half and the Browser half.
 *
 * Contains only pure types and stable protocol constants — no runtime imports
 * from either side, so the Browser bundle never pulls in Node code.
 * @module @harlin97/dsh-ipad-remote/contract
 */
/** Loopback control surface used by the Harness settings card. */
export const CONTROL_PREFIX = '/ipad-remote/api';
/** Device-facing surface owned by the gateway on the network-facing port. */
export const DEVICE_PREFIX = '/__ipad-remote';
/** Accepted PIN length, in digits. Canonical here so both halves enforce one rule. */
export const PIN_LENGTH = 6;
/**
 * Whether a candidate PIN has the accepted shape (exactly {@link PIN_LENGTH} digits).
 *
 * The Host enforces this on every write; the settings card validates with the
 * same function so the user sees the error before a round trip.
 * @param pin - candidate.
 * @returns true when the PIN is well-formed.
 */
export function isValidPinFormat(pin) {
    return new RegExp(`^[0-9]{${String(PIN_LENGTH)}}$`).test(pin);
}
