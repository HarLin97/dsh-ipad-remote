/**
 * The QR code as an SVG node.
 *
 * The surface is deliberately fixed light-on-dark-independently: inverting a QR
 * code (light modules on a dark card) is what stops phone cameras from reading
 * it, so this element does not consume theme tokens.
 * @module @harlin97/dsh-ipad-remote/client/qr-code
 */

import { createElement as h, useMemo } from 'react'
import { qrMatrix, qrPathData, qrViewBoxSize, type QrErrorCorrection } from './qr.js'

/** Module ink. */
const DARK = '#000000'

/** Card behind the code — both the quiet zone and the modules need it. */
const LIGHT = '#ffffff'

/**
 * Render an address as a scannable code.
 * @param props.text - content to encode, normally the address URL.
 * @param props.label - accessible name (the code itself is not readable text).
 * @param props.size - rendered edge length in CSS pixels.
 * @param props.level - error-correction level; defaults to M.
 * @returns the SVG element.
 */
export function QrCode({ text, label, size = 148, level = 'M' }: {
  text: string
  label: string
  size?: number
  level?: QrErrorCorrection
}) {
  const matrix = useMemo(() => qrMatrix(text, level), [text, level])
  const view = qrViewBoxSize(matrix)
  return h('svg', {
    width: size,
    height: size,
    viewBox: `0 0 ${String(view)} ${String(view)}`,
    role: 'img',
    'aria-label': label,
    // Fixed pixels per module: a scaled symbol loses the crisp edges scanners lock on to.
    shapeRendering: 'crispEdges',
    style: { display: 'block', flex: '0 0 auto', borderRadius: '8px', background: LIGHT },
  }, [
    h('rect', { key: 'surface', x: 0, y: 0, width: view, height: view, fill: LIGHT }),
    h('path', { key: 'modules', d: qrPathData(matrix), fill: DARK }),
  ])
}
