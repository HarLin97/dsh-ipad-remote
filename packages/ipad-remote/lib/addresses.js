/**
 * Enumerate the addresses an iPad could reach this host on, and classify them
 * by transport so the settings card can group and label them.
 * @module @harlin97/dsh-ipad-remote/addresses
 */
/** Carriers IPv4 CGNAT space, which Tailscale allocates from. */
const TAILSCALE_PREFIX = '100.64.0.0/10';
/**
 * Parse an IPv4 literal into four octets.
 * @param address - candidate literal.
 * @returns the octets, or undefined when the input is not dotted-quad IPv4.
 */
function octets(address) {
    const parts = address.split('.');
    if (parts.length !== 4)
        return undefined;
    const parsed = parts.map(part => (/^[0-9]{1,3}$/.test(part) ? Number(part) : Number.NaN));
    if (parsed.some(value => !Number.isInteger(value) || value < 0 || value > 255))
        return undefined;
    return parsed;
}
/**
 * Classify one IPv4 literal.
 * @param address - the literal to classify.
 * @returns its transport, or `'skip'` when it is not usefully reachable.
 */
export function classifyIpv4(address) {
    const parsed = octets(address);
    if (parsed === undefined)
        return 'skip';
    const [a, b] = parsed;
    if (a === 127)
        return 'skip'; // loopback
    if (a === 0)
        return 'skip'; // "this network"
    if (a === 169 && b === 254)
        return 'skip'; // link-local / APIPA
    if (a >= 224)
        return 'skip'; // multicast and reserved
    // 100.64.0.0/10 → second octet 64..127
    if (a === 100 && b >= 64 && b <= 127)
        return 'tailscale';
    return 'lan';
}
/**
 * Collect reachable addresses from an interface table.
 * @param interfaces - the table, normally `os.networkInterfaces()`.
 * @returns reachable addresses, sorted by transport then literal.
 */
export function collectAddresses(interfaces) {
    const found = [];
    const seen = new Set();
    for (const [iface, entries] of Object.entries(interfaces)) {
        for (const entry of entries ?? []) {
            if (entry.family !== 'IPv4' || entry.internal)
                continue;
            const transport = classifyIpv4(entry.address);
            if (transport === 'skip' || seen.has(entry.address))
                continue;
            seen.add(entry.address);
            found.push({ address: entry.address, transport, iface });
        }
    }
    return found.sort((a, b) => a.transport === b.transport ? a.address.localeCompare(b.address) : a.transport === 'lan' ? -1 : 1);
}
/**
 * Build the URL an iPad should open for an address.
 * @param address - IPv4 literal.
 * @param port - gateway port.
 * @param scheme - transport scheme; HTTPS is what Android and desktop Chrome
 *   require before they will install the page as an app.
 * @returns the pairing URL.
 */
export function pairingUrl(address, port, scheme = 'http') {
    return `${scheme}://${address}:${String(port)}/`;
}
/** Human-facing transport labels. */
export const TRANSPORT_LABELS = {
    lan: '局域网',
    tailscale: 'Tailscale',
};
/** Exposed for tests and documentation. */
export const TAILSCALE_CIDR = TAILSCALE_PREFIX;
