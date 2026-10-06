/**
 * QR encoding for the settings section.
 *
 * The section renders one code per advertised address, so the encoder is a
 * pure function here and the SVG lives in ./qr-code.tsx: no DOM, no Node, and
 * directly unit-testable (see test/qr.test.ts, which decodes the matrix back).
 *
 * Encoding itself is the vendored MIT implementation in ./vendor — a screen
 * code that scans wrong is worse than no code, so this does not re-derive the
 * Reed-Solomon tables.
 * @module @harlin97/dsh-ipad-remote/client/qr
 */

import qrFactory from './vendor/qrcode-generator.js'

/** Error-correction level; M (≈15% recovery) is the screen-scanning default. */
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'

/** Quiet zone in modules required around the symbol for reliable scanning. */
export const QR_QUIET_ZONE = 4

/** A square matrix of modules, without the quiet zone. */
export interface QrMatrix {
  /** Modules per side. */
  size: number
  /** Row-major modules; `true` is a dark module. */
  modules: readonly (readonly boolean[])[]
}

/** The slice of the vendored factory this module uses. */
interface QrCodeInstance {
  addData(data: string, mode?: string): void
  make(): void
  getModuleCount(): number
  isDark(row: number, column: number): boolean
}

const createQrCode = qrFactory as unknown as (typeNumber: number, level: QrErrorCorrection) => QrCodeInstance

/**
 * Encode text as a QR matrix.
 * @param text - content to encode (byte mode).
 * @param level - error-correction level; defaults to M.
 * @returns the module matrix, quiet zone excluded.
 * @throws when the text does not fit in a version-40 symbol.
 */
export function qrMatrix(text: string, level: QrErrorCorrection = 'M'): QrMatrix {
  // Type number 0 asks the vendored implementation to pick the smallest
  // version that fits, which is what keeps this call site content-agnostic.
  const qr = createQrCode(0, level)
  qr.addData(text, 'Byte')
  qr.make()
  const size = qr.getModuleCount()
  const modules: boolean[][] = []
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = []
    for (let column = 0; column < size; column += 1) line.push(qr.isDark(row, column))
    modules.push(line)
  }
  return { size, modules }
}

/**
 * Build SVG path data for a matrix, one merged horizontal run per dark span.
 *
 * Runs rather than per-module squares keep the attribute small enough that the
 * whole code stays a single node.
 * @param matrix - modules to draw.
 * @param quietZone - quiet zone in modules to offset by.
 * @returns path data in module units.
 */
export function qrPathData(matrix: QrMatrix, quietZone: number = QR_QUIET_ZONE): string {
  const parts: string[] = []
  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.modules[row] ?? []
    let column = 0
    while (column < matrix.size) {
      if (line[column] !== true) {
        column += 1
        continue
      }
      let run = 1
      while (column + run < matrix.size && line[column + run] === true) run += 1
      parts.push(`M${String(column + quietZone)} ${String(row + quietZone)}h${String(run)}v1h-${String(run)}z`)
      column += run
    }
  }
  return parts.join('')
}

/**
 * Side length in module units of the drawn symbol, quiet zone included.
 * @param matrix - encoded modules.
 * @param quietZone - quiet zone in modules.
 * @returns the viewBox side length.
 */
export function qrViewBoxSize(matrix: QrMatrix, quietZone: number = QR_QUIET_ZONE): number {
  return matrix.size + quietZone * 2
}
