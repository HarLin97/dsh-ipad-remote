import { describe, expect, it } from 'vitest'
import { ICON_SIZES, enhanceIndexHtml, iconPath, readIcon, renderManifest } from '../src/pwa.js'

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DSH Local Build</title>
  </head>
  <body><div id="root"></div></body>
</html>
`

describe('enhanceIndexHtml', () => {
  it('adds viewport-fit so safe areas work on iPad', () => {
    expect(enhanceIndexHtml(INDEX)).toContain('content="width=device-width, initial-scale=1, viewport-fit=cover"')
  })

  it('adds the iOS home-screen tags and an apple-touch-icon', () => {
    const html = enhanceIndexHtml(INDEX)
    expect(html).toContain('apple-mobile-web-app-capable')
    expect(html).toContain('apple-mobile-web-app-title')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain(iconPath(180))
  })

  it('declares a theme colour for both schemes', () => {
    const html = enhanceIndexHtml(INDEX)
    expect(html).toContain('prefers-color-scheme: light')
    expect(html).toContain('prefers-color-scheme: dark')
  })

  it('keeps the tags inside head', () => {
    const html = enhanceIndexHtml(INDEX)
    expect(html.indexOf('apple-touch-icon')).toBeLessThan(html.indexOf('</head>'))
  })

  it('is idempotent across repeated renders', () => {
    const once = enhanceIndexHtml(INDEX)
    const twice = enhanceIndexHtml(once)
    expect(twice).toBe(once)
    expect(twice.match(/apple-touch-icon/g)).toHaveLength(1)
  })

  it('does not lose the original document', () => {
    const html = enhanceIndexHtml(INDEX)
    expect(html).toContain('<title>DSH Local Build</title>')
    expect(html).toContain('<div id="root"></div>')
  })

  it('leaves a document without a head untouched apart from the viewport', () => {
    const html = enhanceIndexHtml('<html><body>x</body></html>')
    // The head tags are skipped without a head; the touch runtime still lands,
    // because the body it needs is there.
    expect(html).toContain('<body>x<!-- ipad-remote:mobile-adapt -->')
    expect(html).not.toContain('apple-touch-icon')
  })
})

describe('renderManifest', () => {
  it('parses and uses standalone, which iOS honours reliably', () => {
    const manifest = JSON.parse(renderManifest()) as { display: string; icons: unknown[]; start_url: string }
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('./')
    expect(manifest.icons).toHaveLength(ICON_SIZES.length)
  })

  it('points every icon at a served path', () => {
    const manifest = JSON.parse(renderManifest()) as { icons: Array<{ src: string }> }
    for (const icon of manifest.icons) expect(icon.src).toMatch(/^\/__ipad-remote\/icons\/icon-\d+\.png$/)
  })
})

describe('readIcon', () => {
  it('returns bytes for every shipped size', async () => {
    for (const size of ICON_SIZES) {
      const bytes = await readIcon(`icon-${String(size)}.png`)
      expect(bytes, String(size)).toBeDefined()
      expect(bytes?.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    }
  })

  it('refuses an unshipped size', async () => {
    expect(await readIcon('icon-64.png')).toBeUndefined()
  })

  it('refuses traversal and arbitrary names', async () => {
    for (const bad of ['../config.json', '..%2Fconfig.json', 'icon-180.png/../x', 'package.json', 'icon-.png']) {
      expect(await readIcon(bad), bad).toBeUndefined()
    }
  })
})
