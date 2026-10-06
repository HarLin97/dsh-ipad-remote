/**
 * Local TLS material for the gateway.
 *
 * The gateway speaks plain HTTP by default. That is enough for an iOS
 * home-screen app, but Android and desktop Chrome/Edge refuse to install a PWA
 * from a non-secure origin, so the iPad-remote page can never become an app on
 * those devices without HTTPS.
 *
 * This module only READS a locally issued pair and inspects it. Issuing lives in
 * scripts/make-tls.ps1, which mints a local CA plus a server certificate covering
 * this machine current addresses. Keeping generation out of the runtime keeps the
 * plugin dependency-free and out of the business of writing private keys.
 *
 * Absence is never fatal: a missing or broken pair is reported, and the gateway
 * keeps serving plain HTTP instead of failing to start.
 * @module @harlin97/dsh-ipad-remote/tls
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { X509Certificate } from 'node:crypto'

/** Directory holding the material, beside the state file. */
export const TLS_DIR_NAME = 'tls'

/** File name of the PEM-encoded server certificate. */
export const CERT_FILE = 'server.crt.pem'

/** File name of the PEM-encoded private key. */
export const KEY_FILE = 'server.key.pem'

/** File name of the local CA certificate devices have to trust. */
export const CA_FILE = 'ca.crt.pem'

/** A certificate pair an HTTPS listener can be created from. */
export interface TlsMaterial {
  /** PEM private key. */
  key: Buffer
  /** PEM certificate chain. */
  cert: Buffer
}

/** What the status report knows about the material. */
export interface TlsMaterialReport {
  /** The pair, when both files were readable and the certificate parsed. */
  material?: TlsMaterial
  /** Why HTTPS cannot start, when it cannot. */
  error?: string
  /** Certificate expiry as ISO-8601. */
  expiresAt?: string
  /** Certificate SANs, verbatim as Node reports them. */
  subjectAltName?: string
}

/**
 * Material directory for a given state file, so one setting moves both.
 * @param storePath - absolute path of the state file.
 * @returns the absolute material directory.
 */
export function tlsDir(storePath: string): string {
  return join(dirname(storePath), TLS_DIR_NAME)
}

/**
 * Read and inspect the local certificate pair.
 *
 * Never throws: a missing or unusable pair comes back as an error string, which
 * the settings card shows and the log records.
 * @param storePath - absolute path of the state file.
 * @returns the material, or the reason it is unusable.
 */
export async function loadTls(storePath: string): Promise<TlsMaterialReport> {
  const keyPath = join(tlsDir(storePath), KEY_FILE)
  const certPath = join(tlsDir(storePath), CERT_FILE)
  let key: Buffer
  let cert: Buffer
  try {
    key = await readFile(keyPath)
    cert = await readFile(certPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { error: "no certificate pair in " + tlsDir(storePath) + " (run scripts/make-tls.ps1)" }
    }
    return { error: (error as Error).message }
  }
  try {
    const parsed = new X509Certificate(cert)
    return {
      material: { key, cert },
      expiresAt: new Date(parsed.validTo).toISOString(),
      subjectAltName: parsed.subjectAltName,
    }
  } catch (error) {
    return { error: certPath + " is not a usable certificate: " + (error as Error).message }
  }
}

/**
 * Read the local CA certificate so a new device can download and trust it.
 * @param storePath - absolute path of the state file.
 * @returns the PEM bytes, or undefined when there is no CA.
 */
export async function readCa(storePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(join(tlsDir(storePath), CA_FILE))
  } catch {
    return undefined
  }
}

/**
 * Whether a certificate alternative name covers an address.
 *
 * A home-screen icon bakes in the origin it was installed from, so an address
 * the certificate does not cover is a device that cannot connect, which is worth
 * reporting rather than leaving to a browser warning.
 * @param altNames - the certificate SANs as Node reports them.
 * @param address - IPv4 literal to look for.
 * @returns true when the address appears as an IP SAN.
 */
export function coversAddress(altNames: string | undefined, address: string): boolean {
  if (altNames === undefined) return false
  return altNames.split(",").some(entry => {
    const trimmed = entry.trim()
    return trimmed === "IP Address:" + address || trimmed === "IP:" + address
  })
}
