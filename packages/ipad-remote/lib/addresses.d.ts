/**
 * Enumerate the addresses an iPad could reach this host on, and classify them
 * by transport so the settings card can group and label them.
 * @module @harlin97/dsh-ipad-remote/addresses
 */
import type { NetworkInterfaceInfo } from 'node:os';
import type { Transport } from './contract.js';
export type { Transport };
/** One reachable address. */
export interface ReachableAddress {
    /** IPv4 literal. */
    address: string;
    /** Transport that carries it. */
    transport: Transport;
    /** Originating interface name, for display only. */
    iface: string;
}
/**
 * Classify one IPv4 literal.
 * @param address - the literal to classify.
 * @returns its transport, or `'skip'` when it is not usefully reachable.
 */
export declare function classifyIpv4(address: string): Transport | 'skip';
/**
 * Collect reachable addresses from an interface table.
 * @param interfaces - the table, normally `os.networkInterfaces()`.
 * @returns reachable addresses, sorted by transport then literal.
 */
export declare function collectAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): ReachableAddress[];
/**
 * Build the URL an iPad should open for an address.
 * @param address - IPv4 literal.
 * @param port - gateway port.
 * @param scheme - transport scheme; HTTPS is what Android and desktop Chrome
 *   require before they will install the page as an app.
 * @returns the pairing URL.
 */
export declare function pairingUrl(address: string, port: number, scheme?: 'http' | 'https'): string;
/** Human-facing transport labels. */
export declare const TRANSPORT_LABELS: Record<Transport, string>;
/** Exposed for tests and documentation. */
export declare const TAILSCALE_CIDR = "100.64.0.0/10";
