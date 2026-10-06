/**
 * The offline shell and the mark that gates it.
 *
 * The worker is assembled as strings and shipped verbatim, so the assertions that
 * matter are the ones a type checker cannot make. The body is therefore executed
 * with a stub `self` and its real values inspected — a placeholder that never got
 * substituted, or a bypass entry that never made it into the array, fails here
 * instead of in a browser. The gating assertions cover the other half: the desktop
 * window shares a machine, and often a cookie jar, with the gateway, so a worker
 * registered without the gateway mark could serve the desktop app stale assets.
 */
import { describe, expect, it } from 'vitest'
import { DEVICE_PREFIX } from '../src/contract.js'
import {
  GATEWAY_MARKER,
  REGISTRATION_MARKER,
  SERVICE_WORKER_PATH,
  SERVICE_WORKER_SCOPE,
  pluginVersion,
  renderRegistrationScript,
  renderServiceWorker,
} from '../src/service-worker.js'
import { injectGatewayMarker } from '../src/gateway.js'

const VERSION = '9.9.9'
const source = renderServiceWorker(VERSION)

/** What the worker exposes once its top-level statements have run. */
interface WorkerShape {
  CACHE: string
  SHELL: string[]
  BYPASS: string[]
  OFFLINE_HTML: string
}

/**
 * Execute the rendered worker with a stub global.
 * @returns the values its own code computed.
 */
function loadWorker(): WorkerShape {
  const self = {
    addEventListener: (): void => {},
    skipWaiting: (): void => {},
    clients: { claim: (): void => {} },
    location: { origin: 'https://example.test' },
  }
  const factory = new Function('self', `${source}\nreturn { CACHE: CACHE, SHELL: SHELL, BYPASS: BYPASS, OFFLINE_HTML: OFFLINE_HTML }`)
  return factory(self) as WorkerShape
}

describe('renderServiceWorker', () => {
  it('parses as a script, because it is assembled from strings', () => {
    expect(() => { new Function('self', source) }).not.toThrow()
  })

  it('substitutes the version into the cache name', () => {
    const worker = loadWorker()
    expect(worker.CACHE).toBe(`dsh-ipad-remote-${VERSION}`)
  })

  it('leaves no placeholder behind', () => {
    expect(source).not.toContain('__DSH_IPAD_REMOTE_VERSION__')
    expect(source).not.toContain('__DEVICE_PREFIX__')
  })

  it('pre-caches the shell the app actually opens', () => {
    const worker = loadWorker()
    expect(worker.SHELL).toContain('/')
    expect(worker.SHELL).toContain('/manifest.webmanifest')
    expect(worker.SHELL.some(url => url.includes('/icons/icon-192.png'))).toBe(true)
  })

  it('keeps the control plane and the unlock route out of the cache', () => {
    const worker = loadWorker()
    for (const path of ['/api/', `${DEVICE_PREFIX}/api/`, `${DEVICE_PREFIX}/unlock`]) {
      expect(worker.BYPASS).toContain(path)
    }
  })

  it('retires the previous cache and takes over open pages', () => {
    expect(source).toContain('caches.delete(key)')
    expect(source).toContain('self.skipWaiting()')
    expect(source).toContain('self.clients.claim()')
  })

  it('ignores anything that is not a same-origin GET', () => {
    expect(source).toContain('request.method !== "GET"')
    expect(source).toContain('url.origin !== self.location.origin')
  })

  it('honours no-store, so the per-request browser bundle is not frozen', () => {
    expect(source).toContain('no-store')
  })

  it('explains an offline open instead of showing a blank page', () => {
    const worker = loadWorker()
    expect(worker.OFFLINE_HTML).toContain('host is not answering')
    expect(worker.OFFLINE_HTML).toContain('location.reload()')
  })
})

describe('renderRegistrationScript', () => {
  const snippet = renderRegistrationScript()

  it('parses as a script', () => {
    expect(() => { new Function(snippet) }).not.toThrow()
  })

  it('waits for the gateway mark, and registers at the root scope', () => {
    expect(snippet).toContain(GATEWAY_MARKER)
    expect(snippet).toContain(JSON.stringify(SERVICE_WORKER_PATH))
    expect(snippet).toContain(JSON.stringify(SERVICE_WORKER_SCOPE))
    expect(snippet).toContain('addEventListener("load"')
  })
})

describe('injectGatewayMarker', () => {
  it('marks a document in the head', () => {
    const out = injectGatewayMarker('<html><head><title>t</title></head><body>b</body></html>')
    expect(out).toContain(`${GATEWAY_MARKER}=true`)
    expect(out.indexOf(GATEWAY_MARKER)).toBeLessThan(out.indexOf('</head>'))
  })

  it('is idempotent, so a marked document is never marked twice', () => {
    const once = injectGatewayMarker('<html><head></head></html>')
    expect(injectGatewayMarker(once)).toBe(once)
  })

  it('falls back to the body end, then to the end of the document', () => {
    expect(injectGatewayMarker('<html><body>b</body></html>')).toContain(GATEWAY_MARKER)
    expect(injectGatewayMarker('<p>fragment</p>')).toContain(GATEWAY_MARKER)
  })

  it('does not collide with the injected snippet marker', () => {
    expect(REGISTRATION_MARKER).not.toContain(GATEWAY_MARKER)
  })
})

describe('pluginVersion', () => {
  it('reads the manifest beside the built module', async () => {
    expect(await pluginVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
