/**
 * Generate the iPad home-screen icons.
 *
 * Dependency-free on purpose: upstream's favicon is a complex raster-incompatible
 * vector and copying it would drag in both a native image library and upstream
 * brand assets. This draws a simple terminal-prompt mark instead. Drop real
 * brand PNGs into packages/ipad-remote/assets/ to replace them — nothing else
 * needs to change, the gateway serves whatever is there.
 *
 * Run: node scripts/build-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'ipad-remote', 'assets')
const SIZES = [180, 192, 512]

/** Supersampling factor; edges are averaged down for anti-aliasing. */
const SS = 4

/** Background and mark colours. */
const BG = [0x14, 0x18, 0x22]
const FG = [0xf5, 0xf7, 0xfa]

/** CRC32 table for PNG chunk checksums. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Signed distance from a point to a line segment. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Whether a point falls inside a rounded square covering the whole canvas. */
function insideRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius)
  const cy = Math.min(Math.max(y, radius), size - radius)
  return Math.hypot(x - cx, y - cy) <= radius
}

/**
 * Draw the mark at one size.
 * @param {number} size - output edge length in pixels.
 * @returns {Buffer} RGBA pixels.
 */
function render(size) {
  const hi = size * SS
  const out = Buffer.alloc(size * size * 4)
  const radius = hi * 0.22
  const stroke = hi * 0.075
  // A ">" prompt chevron plus a cursor bar.
  const segments = [
    [hi * 0.30, hi * 0.31, hi * 0.52, hi * 0.50],
    [hi * 0.52, hi * 0.50, hi * 0.30, hi * 0.69],
    [hi * 0.60, hi * 0.69, hi * 0.76, hi * 0.69],
  ]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x * SS + sx + 0.5
          const py = y * SS + sy + 0.5
          if (!insideRoundedSquare(px, py, hi, radius)) continue
          const onMark = segments.some(([ax, ay, bx, by]) => distanceToSegment(px, py, ax, ay, bx, by) <= stroke / 2)
          const colour = onMark ? FG : BG
          r += colour[0]
          g += colour[1]
          b += colour[2]
          a += 255
        }
      }
      const samples = SS * SS
      const offset = (y * size + x) * 4
      // Premultiply against transparent so averaged edge pixels stay correct.
      out[offset] = Math.round(r / samples)
      out[offset + 1] = Math.round(g / samples)
      out[offset + 2] = Math.round(b / samples)
      out[offset + 3] = Math.round(a / samples)
    }
  }
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${String(size)}.png`)
  writeFileSync(file, encodePng(size, size, render(size)))
  console.log(`wrote ${file}`)
}
