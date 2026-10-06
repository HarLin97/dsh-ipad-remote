/**
 * The settings section shows a scannable code per address, so these tests
 * decode what the encoder produces instead of only measuring it: a matrix of
 * the right size that no camera can read would still be a broken feature.
 */

import { describe, expect, it } from 'vitest'
import jsQRModule from 'jsqr'
import { QR_QUIET_ZONE, qrMatrix, qrPathData, qrViewBoxSize, type QrMatrix } from '../src/client/qr.js'

/** Decoder entry point. The published typings describe a CJS namespace, so the
 *  callable shape is asserted here rather than re-declared in every test. */
const decodeQr = jsQRModule as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null

/** One address the gateway actually advertises. */
const LAN_URL = 'http://192.0.2.10:50070/'

/** A Tailscale CGNAT address, the other carrier family. */
const TAILSCALE_URL = 'http://100.101.102.103:50070/'

/** A MagicDNS name: longer, and the case that pushes into a bigger symbol. */
const MAGIC_DNS_URL = 'http://example-desktop.tailnet-1a2b3c.ts.net:50070/'

/**
 * Rasterize a matrix into the RGBA buffer a decoder consumes.
 * @param matrix - encoded modules.
 * @param scale - pixels per module.
 * @returns image data plus its dimensions.
 */
function rasterize(matrix: QrMatrix, scale = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const side = (matrix.size + QR_QUIET_ZONE * 2) * scale
  const data = new Uint8ClampedArray(side * side * 4)
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const row = Math.floor(y / scale) - QR_QUIET_ZONE
      const column = Math.floor(x / scale) - QR_QUIET_ZONE
      const dark = row >= 0 && column >= 0 && row < matrix.size && column < matrix.size
        && matrix.modules[row]?.[column] === true
      const value = dark ? 0 : 255
      const offset = (y * side + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  return { data, width: side, height: side }
}

/**
 * Rebuild the module grid from the SVG path data the component draws.
 * @param path - path data produced by {@link qrPathData}.
 * @param side - viewBox side length in modules, quiet zone included.
 * @returns a grid of dark-module flags, quiet zone included.
 */
function gridFromPath(path: string, side: number): boolean[][] {
  const grid = Array.from({ length: side }, () => Array.from({ length: side }, () => false))
  const pattern = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g
  let match = pattern.exec(path)
  let runs = 0
  while (match !== null) {
    runs += 1
    const x = Number(match[1])
    const y = Number(match[2])
    const width = Number(match[3])
    expect(Number(match[4])).toBe(width)
    for (let i = 0; i < width; i += 1) grid[y]![x + i] = true
    match = pattern.exec(path)
  }
  expect(path.match(/M/g) ?? []).toHaveLength(runs)
  return grid
}

describe('qrMatrix', () => {
  it('produces a square symbol with a finder pattern in each corner', () => {
    const matrix = qrMatrix(LAN_URL)
    expect(matrix.size).toBeGreaterThanOrEqual(21)
    expect(matrix.modules).toHaveLength(matrix.size)
    for (const row of matrix.modules) expect(row).toHaveLength(matrix.size)
    // Top-left finder: dark 7x7 border with a dark 3x3 core.
    expect(matrix.modules[0]?.[0]).toBe(true)
    expect(matrix.modules[6]?.[6]).toBe(true)
    expect(matrix.modules[1]?.[1]).toBe(false)
    expect(matrix.modules[3]?.[3]).toBe(true)
  })

  it.each([
    ['LAN address', LAN_URL],
    ['Tailscale address', TAILSCALE_URL],
    ['MagicDNS name', MAGIC_DNS_URL],
  ])('decodes a %s back to the exact URL', (_label, url) => {
    const image = rasterize(qrMatrix(url))
    const decoded = decodeQr(image.data, image.width, image.height)
    expect(decoded?.data).toBe(url)
  })

  it('stays decodable at the strongest correction level', () => {
    const image = rasterize(qrMatrix(TAILSCALE_URL, 'H'))
    expect(decodeQr(image.data, image.width, image.height)?.data).toBe(TAILSCALE_URL)
  })
})

describe('qrPathData', () => {
  it('draws exactly the dark modules, offset by the quiet zone', () => {
    const matrix = qrMatrix(LAN_URL)
    const side = qrViewBoxSize(matrix)
    const grid = gridFromPath(qrPathData(matrix), side)
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        expect(grid[row + QR_QUIET_ZONE]?.[column + QR_QUIET_ZONE]).toBe(matrix.modules[row]?.[column])
      }
    }
    // The quiet zone itself stays empty, and nothing is drawn outside the symbol.
    for (let i = 0; i < side; i += 1) {
      expect(grid[0]?.[i]).toBe(false)
      expect(grid[side - 1]?.[i]).toBe(false)
      expect(grid[i]?.[0]).toBe(false)
      expect(grid[i]?.[side - 1]).toBe(false)
    }
  })

  it('sizes the viewBox as the symbol plus both quiet-zone bands', () => {
    const matrix = qrMatrix(LAN_URL, 'H')
    expect(qrViewBoxSize(matrix)).toBe(matrix.size + QR_QUIET_ZONE * 2)
    expect(qrViewBoxSize(matrix, 0)).toBe(matrix.size)
  })
})
