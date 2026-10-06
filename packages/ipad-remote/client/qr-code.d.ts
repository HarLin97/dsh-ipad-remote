/**
 * The QR code as an SVG node.
 *
 * The surface is deliberately fixed light-on-dark-independently: inverting a QR
 * code (light modules on a dark card) is what stops phone cameras from reading
 * it, so this element does not consume theme tokens.
 * @module @harlin97/dsh-ipad-remote/client/qr-code
 */
import { type QrErrorCorrection } from './qr.js';
/**
 * Render an address as a scannable code.
 * @param props.text - content to encode, normally the address URL.
 * @param props.label - accessible name (the code itself is not readable text).
 * @param props.size - rendered edge length in CSS pixels.
 * @param props.level - error-correction level; defaults to M.
 * @returns the SVG element.
 */
export declare function QrCode({ text, label, size, level }: {
    text: string;
    label: string;
    size?: number;
    level?: QrErrorCorrection;
}): import("react").ReactSVGElement;
