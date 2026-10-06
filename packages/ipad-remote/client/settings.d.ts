/**
 * Browser half of the iPad remote-access plugin: registers the settings
 * section that owns the feature's controls.
 *
 * The Host half owns the gateway and the loopback control surface; this half
 * only presents them. It is served by the Harness client module system, which
 * finds this package's manifest through the Loader row that mounted the Host
 * half and serves the built `./client` bundle.
 * @module @harlin97/dsh-ipad-remote/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type IpadRemoteKey } from './locales.js';
/** Stable client-plugin name; matches the Host half and the package name. */
export declare const name = "ipad-remote";
/** Services this half needs before it may register anything. */
export declare const inject: string[];
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Remote-access section copy. */
        'ipad-remote': IpadRemoteKey;
    }
}
/**
 * Register the section and its dictionaries.
 * @param ctx - owning client plugin context.
 */
export declare function apply(ctx: ClientContext): void;
