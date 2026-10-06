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
/** Directory holding the material, beside the state file. */
export declare const TLS_DIR_NAME = "tls";
/** File name of the PEM-encoded server certificate. */
export declare const CERT_FILE = "server.crt.pem";
/** File name of the PEM-encoded private key. */
export declare const KEY_FILE = "server.key.pem";
/** File name of the local CA certificate devices have to trust. */
export declare const CA_FILE = "ca.crt.pem";
/** A certificate pair an HTTPS listener can be created from. */
export interface TlsMaterial {
    /** PEM private key. */
    key: Buffer;
    /** PEM certificate chain. */
    cert: Buffer;
}
/** What the status report knows about the material. */
export interface TlsMaterialReport {
    /** The pair, when both files were readable and the certificate parsed. */
    material?: TlsMaterial;
    /** Why HTTPS cannot start, when it cannot. */
    error?: string;
    /** Certificate expiry as ISO-8601. */
    expiresAt?: string;
    /** Certificate SANs, verbatim as Node reports them. */
    subjectAltName?: string;
}
/**
 * Material directory for a given state file, so one setting moves both.
 * @param storePath - absolute path of the state file.
 * @returns the absolute material directory.
 */
export declare function tlsDir(storePath: string): string;
/**
 * Read and inspect the local certificate pair.
 *
 * Never throws: a missing or unusable pair comes back as an error string, which
 * the settings card shows and the log records.
 * @param storePath - absolute path of the state file.
 * @returns the material, or the reason it is unusable.
 */
export declare function loadTls(storePath: string): Promise<TlsMaterialReport>;
/**
 * Read the local CA certificate so a new device can download and trust it.
 * @param storePath - absolute path of the state file.
 * @returns the PEM bytes, or undefined when there is no CA.
 */
export declare function readCa(storePath: string): Promise<Buffer | undefined>;
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
export declare function coversAddress(altNames: string | undefined, address: string): boolean;
