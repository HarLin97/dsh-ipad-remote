/**
 * The iPad-remote state machine: owns persisted state, the gateway lifecycle,
 * and both HTTP surfaces (loopback control, network-facing device).
 * @module @harlin97/dsh-ipad-remote/remote-access
 */
import { networkInterfaces } from 'node:os';
import { TRANSPORT_LABELS, collectAddresses, pairingUrl } from './addresses.js';
import { CONTROL_PREFIX, DEVICE_PREFIX } from './contract.js';
import { Gateway, readCookie, sessionClearCookie, sessionSetCookie } from './gateway.js';
import { InnerSession, exchangeForCookie } from './inner-session.js';
import { PinThrottle, hashPin, verifyPin } from './pin.js';
import { SessionAuthority, SESSION_COOKIE } from './session.js';
import { ConfigStore, DEFAULT_STATE } from './store.js';
import { callerKey, readBody, sameOrigin, sendBytes, sendHtml, sendJson } from './routes.js';
import { ICON_PREFIX, MANIFEST_PATH, readIcon, renderManifest } from './pwa.js';
import { coversAddress, loadTls, readCa } from './tls.js';
import { LOGOUT_PATH, UNLOCK_PATH, renderUnlockPage } from './unlock-page.js';
/** Milliseconds in one day. */
const DAY_MS = 86_400_000;
/** Seconds in one day, for cookie max-age. */
const DAY_SECONDS = 86_400;
/** Loopback address the Harness webserver always answers on. */
const LOOPBACK = '127.0.0.1';
/** Public path a new device downloads the local CA from. */
const CA_PATH = `${DEVICE_PREFIX}/ca.crt`;
/** Serialize an error for a JSON body without leaking a stack. */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Owns everything the plugin mounted, so mounting twice or disposing twice is safe.
 */
export class RemoteAccess {
    host;
    config;
    state = { ...DEFAULT_STATE };
    loaded = false;
    gateway;
    secure;
    tlsReport = {};
    /**
     * The PIN set during this process run, if any.
     *
     * Deliberately memory-only: the state file keeps a scrypt verifier and never
     * the PIN, so this dies with the process and a restart simply reports that the
     * value is no longer recoverable.
     */
    currentPin;
    sessions;
    throttle = new PinThrottle();
    inner;
    store;
    /**
     * @param host - adapter over the Cordis services this plugin needs.
     * @param config - resolved deployment config.
     */
    constructor(host, config) {
        this.host = host;
        this.config = config;
        this.store = new ConfigStore(config.storePath);
        this.sessions = new SessionAuthority(undefined, config.maxSessions);
        this.inner = new InnerSession(async () => {
            const port = this.harnessPort();
            const url = this.host.authenticatedUrl(`http://${LOOPBACK}:${String(port)}/`);
            return await exchangeForCookie(url, { host: LOOPBACK, port });
        });
    }
    /** Port the Harness webserver listens on. */
    harnessPort() {
        const port = this.host.webServerPort();
        if (!Number.isInteger(port) || port <= 0) {
            throw new Error('ipad-remote: the Harness webserver is not listening yet');
        }
        return port;
    }
    /** Load persisted state once. */
    async ensureLoaded() {
        if (this.loaded)
            return;
        this.state = await this.store.load();
        // Certificate material is read once per load: it decides whether an HTTPS
        // listener exists at all, and status() has to be able to explain its absence.
        this.tlsReport = await loadTls(this.config.storePath);
        this.loaded = true;
    }
    /** Start the gateway when the persisted state says it should be up. */
    async start() {
        try {
            await this.ensureLoaded();
            if (this.state.enabled)
                await this.applyEnabled(true);
        }
        catch (error) {
            this.log('warn', `did not start: ${messageOf(error)}`);
        }
    }
    /** Stop both listeners and release every resource. Safe to call repeatedly. */
    async dispose() {
        await this.stopListeners();
    }
    /** Stop the plain and the secure listener, whichever are up. */
    async stopListeners() {
        const secure = this.secure;
        const gateway = this.gateway;
        this.secure = undefined;
        this.gateway = undefined;
        if (secure !== undefined)
            await secure.stop();
        if (gateway !== undefined)
            await gateway.stop();
    }
    /** Current status for the settings card. */
    status() {
        const addresses = collectAddresses(networkInterfaces()).map(entry => ({
            address: entry.address,
            iface: entry.iface,
            transport: entry.transport,
            label: TRANSPORT_LABELS[entry.transport],
            // The secure origin wins while it is up: it is the only one Android and
            // desktop Chrome install from, and an app installed from it keeps working
            // across a certificate renewal.
            url: this.secure === undefined
                ? pairingUrl(entry.address, this.state.port, 'http')
                : pairingUrl(entry.address, this.state.tlsPort, 'https'),
        }));
        return {
            enabled: this.state.enabled,
            // "Wanted up and actually up": a listener that is already on its way
            // down reports false here, so (enabled && !listening) keeps its single
            // meaning — the port could not be taken.
            listening: this.state.enabled && this.gateway !== undefined,
            port: this.state.port,
            bindHost: this.config.bindHost,
            hasPin: this.state.pinHash !== null,
            ...(this.currentPin === undefined ? {} : { currentPin: this.currentPin }),
            tls: this.tlsStatus(addresses),
            addresses,
            sessions: this.sessions.list().map(entry => ({
                label: entry.label,
                issuedAt: new Date(entry.iat).toISOString(),
                expiresAt: new Date(entry.exp).toISOString(),
            })),
            storePath: this.config.storePath,
        };
    }
    /**
     * HTTPS state for the card.
     *
     * `enabled` answers "was a usable pair found", `listening` answers "is it up",
     * and the uncovered addresses answer "will my device actually connect" — the
     * question a stale certificate raises, because a home-screen icon bakes in the
     * origin it was installed from.
     * @param addresses - the addresses already computed for this report.
     * @returns the TLS slice of the status.
     */
    tlsStatus(addresses) {
        const material = this.tlsReport.material;
        const lan = addresses.filter(entry => entry.transport === 'lan').map(entry => entry.address);
        return {
            enabled: material !== undefined,
            listening: this.secure !== undefined,
            port: this.state.tlsPort,
            ...(this.tlsReport.expiresAt === undefined ? {} : { expiresAt: this.tlsReport.expiresAt }),
            ...(this.tlsReport.subjectAltName === undefined ? {} : { subjectAltName: this.tlsReport.subjectAltName }),
            ...(this.tlsReport.error === undefined ? {} : { error: this.tlsReport.error }),
            uncoveredAddresses: material === undefined
                ? []
                : lan.filter(address => !coversAddress(this.tlsReport.subjectAltName, address)),
        };
    }
    /**
     * Bring the listener up or down.
     * @param enabled - desired state.
     * @throws when enabling without a PIN, or when the port cannot be bound.
     */
    async applyEnabled(enabled) {
        if (enabled) {
            if (this.state.pinHash === null)
                throw new Error('请先设置 PIN，再开启远程访问');
            if (this.gateway !== undefined)
                return;
            const shared = {
                bindHost: this.config.bindHost,
                target: { host: LOOPBACK, port: this.harnessPort() },
                sessions: this.sessions,
                control: { prefix: DEVICE_PREFIX, handle: (req, res) => this.handleDevice(req, res) },
                upstreamHeaders: async () => {
                    const cookies = await this.inner.cookies();
                    const headers = {};
                    if (cookies !== undefined)
                        headers['cookie'] = cookies;
                    return headers;
                },
                log: (level, message) => { this.log(level, message); },
            };
            const gateway = new Gateway({ ...shared, port: this.state.port });
            await gateway.start();
            this.gateway = gateway;
            // HTTPS is never fatal. A missing or unusable pair leaves the plain
            // listener serving and is reported through status().tls, because a remote
            // device that cannot install the app is still better off than one that
            // cannot reach it at all.
            const material = this.tlsReport.material;
            if (material !== undefined) {
                try {
                    const secure = new Gateway({ ...shared, port: this.state.tlsPort, tls: material });
                    await secure.start();
                    this.secure = secure;
                }
                catch (error) {
                    this.tlsReport = { ...this.tlsReport, error: messageOf(error) };
                    this.log('warn', `HTTPS listener did not start: ${messageOf(error)}`);
                }
            }
            return;
        }
        await this.stopListeners();
    }
    /**
     * Persist and apply a new enabled flag. State is only recorded once the
     * listener actually came up, so a failed bind does not leave a state file
     * claiming the gateway is running.
     * @param enabled - desired state.
     */
    async setEnabled(enabled) {
        await this.ensureLoaded();
        await this.applyEnabled(enabled);
        this.state = { ...this.state, enabled };
        await this.persist();
    }
    /**
     * Replace the PIN. Existing sessions are deliberately left alive; the card
     * offers an explicit revoke for that (design spec §8 limitation 2).
     * @param pin - the new PIN.
     */
    async setPin(pin) {
        await this.ensureLoaded();
        const pinHash = await hashPin(pin);
        this.state = { ...this.state, pinHash };
        this.currentPin = pin;
        await this.persist();
    }
    /**
     * Persist "not enabled" and release the listener once `res` is flushed.
     *
     * The settings card can be reached *through* the gateway — that is exactly
     * how an iPad sees it — so this answer travels on one of the device sockets
     * that {@link Gateway.stop} destroys. Stopping first would kill the response
     * and the card would report a failure for a change that did happen; the state
     * flips immediately instead, and the socket is released after the bytes leave.
     * @param res - response carrying the new status.
     */
    async disableAfterAnswering(res) {
        await this.ensureLoaded();
        this.state = { ...this.state, enabled: false };
        await this.persist();
        let released = false;
        const release = () => {
            if (released)
                return;
            released = true;
            void this.dispose();
        };
        // `finish` is the normal path; `close` covers a client that hung up first,
        // which must not leave a listener running that the state calls disabled.
        res.once('finish', release);
        res.once('close', release);
    }
    /** Revoke every issued session. */
    async revokeAll() {
        await this.ensureLoaded();
        this.sessions.revokeAll();
    }
    /** Persist state atomically. */
    async persist() {
        await this.store.save(this.state);
    }
    /** Tear down the listener across reloads, then rebuild it from fresh state. */
    async reload() {
        this.loaded = false;
        await this.dispose();
        await this.start();
    }
    /**
     * Answer a loopback control request.
     * @param req - incoming request.
     * @param res - response to write.
     */
    async handleControl(req, res) {
        const route = (req.url ?? '/').slice(CONTROL_PREFIX.length).split('?')[0] ?? '';
        try {
            await this.ensureLoaded();
            if (req.method === 'GET' && route === '/status') {
                sendJson(res, 200, this.status());
                return;
            }
            if (req.method === 'POST' && (route === '/enable' || route === '/pin' || route === '/revoke')) {
                if (!sameOrigin(req)) {
                    sendJson(res, 403, { error: '跨站请求被拒绝' });
                    return;
                }
                const body = await readBody(req);
                if (route === '/enable') {
                    const enabled = body['enabled'];
                    if (typeof enabled !== 'boolean') {
                        sendJson(res, 400, { error: 'enabled 必须是布尔值' });
                        return;
                    }
                    if (!enabled) {
                        await this.disableAfterAnswering(res);
                        sendJson(res, 200, this.status());
                        return;
                    }
                    await this.setEnabled(true);
                    sendJson(res, 200, this.status());
                    return;
                }
                if (route === '/pin') {
                    const pin = body['pin'];
                    if (typeof pin !== 'string') {
                        sendJson(res, 400, { error: '缺少 PIN' });
                        return;
                    }
                    await this.setPin(pin);
                    sendJson(res, 200, this.status());
                    return;
                }
                await this.revokeAll();
                sendJson(res, 200, this.status());
                return;
            }
            sendJson(res, 404, { error: '未知的控制接口' });
        }
        catch (error) {
            sendJson(res, 400, { error: messageOf(error) });
        }
    }
    /**
     * Answer a device-facing request the gateway owns.
     * @param req - incoming request.
     * @param res - response to write.
     * @returns true when this answered; false lets the gateway fall through.
     */
    async handleDevice(req, res) {
        const path = (req.url ?? '/').split('?')[0] ?? '';
        if (path === UNLOCK_PATH && req.method === 'GET') {
            sendHtml(res, 200, renderUnlockPage());
            return true;
        }
        if (path === UNLOCK_PATH && req.method === 'POST') {
            await this.submitPin(req, res);
            return true;
        }
        // Gateway-only: the upstream manifest stays untouched for desktop users.
        if (path === MANIFEST_PATH && req.method === 'GET') {
            sendBytes(res, 200, Buffer.from(renderManifest(), 'utf8'), 'application/manifest+json; charset=utf-8', 3600);
            return true;
        }
        if (path.startsWith(ICON_PREFIX + '/') && req.method === 'GET') {
            const icon = await readIcon(path.slice(ICON_PREFIX.length + 1));
            if (icon === undefined)
                return false;
            sendBytes(res, 200, icon, 'image/png', 86_400);
            return true;
        }
        // Onboarding: a device cannot trust the HTTPS origin before it holds the
        // local CA, so this answers without a session. A CA certificate is public by
        // nature and carries no private material.
        if (path === CA_PATH && req.method === 'GET') {
            const ca = await readCa(this.config.storePath);
            if (ca === undefined)
                return false;
            sendBytes(res, 200, ca, 'application/x-x509-ca-cert', 3600);
            return true;
        }
        if (path === LOGOUT_PATH && req.method === 'POST') {
            res.writeHead(303, { 'set-cookie': sessionClearCookie(), location: '/' });
            res.end();
            return true;
        }
        return false;
    }
    /** Verify a submitted PIN and establish the device session. */
    async submitPin(req, res) {
        const key = callerKey(req);
        const decision = this.throttle.check(key);
        if (!decision.allowed) {
            sendHtml(res, 429, renderUnlockPage({
                error: '尝试次数过多。',
                retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000),
            }));
            return;
        }
        let pin = '';
        try {
            const body = await readBody(req);
            const value = body['pin'];
            pin = typeof value === 'string' ? value : '';
        }
        catch {
            sendHtml(res, 400, renderUnlockPage({ error: '无法读取提交内容。' }));
            return;
        }
        if (!await verifyPin(pin, this.state.pinHash)) {
            this.throttle.recordFailure(key);
            this.log('warn', `rejected an unlock attempt from ${key}`);
            sendHtml(res, 401, renderUnlockPage({ error: 'PIN 不正确。' }));
            return;
        }
        this.throttle.reset(key);
        const issued = this.sessions.issue('iPad', this.state.sessionDays * DAY_MS);
        // A Secure cookie is dropped by the browser when the page arrived over plain
        // HTTP, so it is added only when this very request came through TLS.
        const secure = req.socket.encrypted === true;
        res.writeHead(303, {
            'set-cookie': sessionSetCookie(issued.cookie, this.state.sessionDays * DAY_SECONDS, secure),
            location: '/',
        });
        res.end();
        this.log('info', 'a device unlocked the gateway');
    }
    log(level, message) {
        this.host.log(level, message);
    }
}
/** Re-exported so callers do not need the gateway module. */
export { readCookie, SESSION_COOKIE };
