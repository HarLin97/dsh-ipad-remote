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
/** Error-correction level; M (≈15% recovery) is the screen-scanning default. */
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';
/** Quiet zone in modules required around the symbol for reliable scanning. */
export declare const QR_QUIET_ZONE = 4;
/** A square matrix of modules, without the quiet zone. */
export interface QrMatrix {
    /** Modules per side. */
    size: number;
    /** Row-major modules; `true` is a dark module. */
    modules: readonly (readonly boolean[])[];
}
/**
 * Encode text as a QR matrix.
 * @param text - content to encode (byte mode).
 * @param level - error-correction level; defaults to M.
 * @returns the module matrix, quiet zone excluded.
 * @throws when the text does not fit in a version-40 symbol.
 */
export declare function qrMatrix(text: string, level?: QrErrorCorrection): QrMatrix;
/**
 * Build SVG path data for a matrix, one merged horizontal run per dark span.
 *
 * Runs rather than per-module squares keep the attribute small enough that the
 * whole code stays a single node.
 * @param matrix - modules to draw.
 * @param quietZone - quiet zone in modules to offset by.
 * @returns path data in module units.
 */
export declare function qrPathData(matrix: QrMatrix, quietZone?: number): string;
/**
 * Side length in module units of the drawn symbol, quiet zone included.
 * @param matrix - encoded modules.
 * @param quietZone - quiet zone in modules.
 * @returns the viewBox side length.
 */
export declare function qrViewBoxSize(matrix: QrMatrix, quietZone?: number): number;
