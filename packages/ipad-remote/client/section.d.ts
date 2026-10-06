/**
 * "iPad remote access" — the settings section body.
 *
 * One place to switch the gateway on or off, set the access PIN, read the
 * addresses an iPad can open (with a scannable code each), and revoke every
 * unlocked device. Everything it renders comes from the loopback control
 * surface via {@link ControlApi}; nothing here reaches the network gateway.
 *
 * Written with `createElement` rather than JSX so the browser bundle needs no
 * JSX transform — the same shape the reference client plugin uses.
 * @module @harlin97/dsh-ipad-remote/client/section
 */
import { type ControlApi } from './api.js';
import type { IpadRemoteKey } from './locales.js';
/** Props the settings shell injects. */
export interface IpadRemoteSectionProps {
    /** Localized copy for the `ipad-remote` namespace. */
    t: (key: IpadRemoteKey) => string;
    /** Control client; tests inject a stub, the page builds the real one. */
    api?: ControlApi;
}
/**
 * The remote-access settings page.
 * @param props.t - localized copy.
 * @param props.api - control client override.
 * @returns the section element.
 */
export declare function IpadRemoteSection({ t, api }: IpadRemoteSectionProps): import("react").DetailedReactHTMLElement<{
    style: {
        display: "flex";
        flexDirection: "column";
        gap: string;
        maxWidth: string;
        fontSize: string;
        lineHeight: string;
        color: "var(--dsw-alias-label-primary)";
    };
}, HTMLElement>;
