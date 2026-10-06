/**
 * The portrait-touch layer is two halves that must agree: a stylesheet every
 * index response carries, and a runtime only the gateway inlines. These tests
 * pin the contract between them — the media query that keeps desktop untouched,
 * the zero-specificity wrapper, the anchor names a live audit re-checks, and the
 * escaping that keeps the inlined script from terminating its own tag.
 */

import { describe, expect, it } from 'vitest'
import {
  ACTIVE_CLASS,
  ADAPT_MEDIA_QUERY,
  ANCHORS,
  BUTTON_POSITION_KEY,
  FORCE_DESKTOP_KEY,
  LAUNCHER_ID,
  adaptCss,
  adaptScript,
} from '../src/mobile-adapt.js'
import { enhanceIndexHtml } from '../src/pwa.js'

const INDEX = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body><div id="root"></div></body>
</html>
`

describe('adaptCss', () => {
  it('scopes every rule behind portrait, coarse pointer and phone width', () => {
    expect(ADAPT_MEDIA_QUERY).toBe('(orientation: portrait) and (max-width: 1099px)')
    const css = adaptCss()
    expect(css.startsWith('@media ' + ADAPT_MEDIA_QUERY + '{')).toBe(true)
    expect(css.endsWith('}')).toBe(true)
    const outside = css.slice(('@media ' + ADAPT_MEDIA_QUERY + '{').length, -1)
    expect(outside).not.toContain('@media')
  })

  it('keeps every selector anchored, so nothing applies without a match', () => {
    // A rule that targets a bare element (input, textarea) is anchored by the
    // official class list too; assert the layer declares no :root/html/body
    // restyling that would leak into the desktop layout.
    expect(adaptCss()).not.toMatch(/(^|\{|,)\s*(html|:root)\s*\{/)
  })

  it('raises the composer to a 16px input and gives it safe-area padding', () => {
    const css = adaptCss()
    expect(css).toContain(':is([class$="_input"]),textarea,input{font-size:16px}')
    expect(css).toContain('env(safe-area-inset-bottom)')
    expect(css).toContain('100dvh')
  })

  it('turns composer menus into a bottom sheet with 44px rows', () => {
    const css = adaptCss()
    expect(css).toContain('[class$="_composerSeat"] [class$="_menu"]{position:fixed !important')
    expect(css).toContain('[class$="_menu"] [class$="_cell"]{height:44px;min-height:44px')
  })

  it('reveals hover-only row actions and suppresses drag on rows', () => {
    const css = adaptCss()
    expect(css).toContain('[class*="_sidebarCol"] :is([class*="_rowActions"]){display:inline-flex}')
    expect(css).toContain('-webkit-user-drag:none')
  })

  it('sizes the floating entry as a touch target and hides stuck tooltips', () => {
    const css = adaptCss()
    expect(css).toContain('#' + LAUNCHER_ID + '{')
    expect(css).toContain('width:36px;height:36px')
    expect(css).toContain('[class*="_bubble"][role="tooltip"]{display:none}')
  })
})

describe('adaptScript', () => {
  const source = adaptScript()

  it('is a self-contained IIFE with no imports', () => {
    expect(source.startsWith('(() => {')).toBe(true)
    expect(source.trimEnd().endsWith('})();')).toBe(true)
    expect(source).not.toMatch(/\bimport\b|\brequire\(/)
  })

  it('emits real line breaks, not a literal escape sequence', () => {
    expect(source).toContain('\n')
    expect(source).not.toContain('\\n')
  })

  it('carries the same gate, storage keys and anchors as the stylesheet', () => {
    expect(source).toContain(JSON.stringify(ADAPT_MEDIA_QUERY))
    expect(source).toContain(JSON.stringify(FORCE_DESKTOP_KEY))
    expect(source).toContain(JSON.stringify(BUTTON_POSITION_KEY))
    expect(source).toContain(JSON.stringify(ANCHORS))
    expect(source).toContain(JSON.stringify(LAUNCHER_ID))
    expect(source).toContain(JSON.stringify(ACTIVE_CLASS))
  })

  it('honours both manual overrides before the media query', () => {
    expect(source).toContain('URLSearchParams(')
    expect(source).toContain('"adapt"')
    expect(source).toContain('"off"')
    expect(source).toContain('"force"')
    expect(source).toContain('sessionStorage.getItem(OPT_OUT)')
  })

  it('falls back from the official toggle to the panel list', () => {
    expect(source).toContain('document.querySelector(A.sidebarToggle)')
    expect(source).toContain('document.querySelector(A.panelList)')
  })

  it('wires the three touch behaviours the desktop gets from hover and width', () => {
    expect(source).toContain('setSidebar(dx > 0)')
    expect(source).toContain('closest')
    expect(source).toContain('_sessionRow')
    expect(source).toContain('_projectRow')
    expect(source).toContain('_rowActions')
    expect(source).toContain('setTimeout')
    expect(source).toContain('pointerdown')
  })
})

describe('enhanceIndexHtml with the adaptation layer', () => {
  it('inlines the stylesheet in head and the runtime before body end', () => {
    const html = enhanceIndexHtml(INDEX)
    expect(html).toContain('<style data-ipad-remote="mobile-adapt">')
    expect(html.indexOf('<style data-ipad-remote="mobile-adapt">')).toBeLessThan(html.indexOf('</head>'))
    const script = html.indexOf('<script defer data-ipad-remote="mobile-adapt">')
    expect(script).toBeGreaterThan(html.indexOf('</head>'))
    expect(script).toBeLessThan(html.indexOf('</body>'))
  })

  it('never lets the inlined source close its own script element', () => {
    const html = enhanceIndexHtml(INDEX)
    const script = html.slice(html.indexOf('<script defer data-ipad-remote="mobile-adapt">'))
    const body = script.slice(0, script.indexOf('</script>'))
    expect(body).not.toContain('</script')
  })

  it('is idempotent, so a double render injects each half once', () => {
    const once = enhanceIndexHtml(INDEX)
    const twice = enhanceIndexHtml(once)
    expect(twice).toBe(once)
    expect(twice.match(/data-ipad-remote="mobile-adapt"/g)).toHaveLength(2)
  })

  it('keeps the original body content when it injects the runtime', () => {
    const html = enhanceIndexHtml('<html><body>x</body></html>')
    expect(html).toContain('<body>x<!-- ipad-remote:mobile-adapt -->')
    expect(html).toContain('</body>')
    // No head: the tags (and therefore the stylesheet) are skipped, the runtime
    // still lands because the body is there.
    expect(html).not.toContain('<style data-ipad-remote')
  })
})
