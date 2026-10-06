/**
 * Portrait-touch adaptation for the official Web GUI.
 *
 * The iPad opens the same page the desktop does, and the official layout stops
 * at "collapse the sidebar below 1024px". On a phone-sized portrait screen that
 * still leaves desktop-sized targets, a 12px composer that iOS zooms into, no
 * safe-area padding, menus anchored past the right edge, and hover-only row
 * actions that touch can never reveal. This module carries the layer that fixes
 * exactly that: a stylesheet plus a small dependency-free runtime.
 *
 * Delivery is asymmetric on purpose. The stylesheet is injected into every index
 * response through the webserver's public tapIndex hook — inert on desktop,
 * because every rule is scoped by a portrait/touch/width media query — while the
 * runtime script is inlined only by the gateway (see gateway.ts), so the desktop
 * page carries no script at all. No official file is modified, and the client
 * module system is not involved: an adaptation layer that only exists when the
 * plugin's own client bundle is loaded would silently do nothing.
 *
 * Anchors, verified against the running GUI by scripts/inspect-gui-dom.mjs
 * (inventory in docs/gui-selectors.md):
 * - data-slot hooks, which are semantic and stable: sidebar.brand.mark,
 *   sidebar.panellist, conversation.composer, conversation.header.
 * - CSS-Modules semantic suffixes (\`[class$="_composerSeat"]\`), which survive
 *   upstream rebuilds that only change the hash: _composerSeat, _input, _menu,
 *   _sessionRow, _projectRow, _rowActions, _titleRow.
 * - The official sidebar state stamp \`[data-sidebar-collapsed]\`.
 *
 * The anchor strategy, the feature gate and several rule names follow
 * \`@linxin666/dsh-remote-web-ui\` (Apache-2.0) and the dsh-LAN reference it
 * ports (MIT); the rules here were re-derived against anchors this repository
 * verified itself. See THIRD-PARTY-NOTICES.md.
 * @module @harlin97/dsh-ipad-remote/mobile-adapt
 */
/** Storage key that turns the layer off for one browser tab. */
export declare const FORCE_DESKTOP_KEY = "ipad-remote-force-desktop";
/** Storage key holding the dragged floating-button position. */
export declare const BUTTON_POSITION_KEY = "ipad-remote-launcher-pos";
/** Id of the injected floating button. */
export declare const LAUNCHER_ID = "ipadRemoteLauncher";
/** Body class while the layer is driving the page. */
export declare const ACTIVE_CLASS = "ipad-remote-portrait";
/** The media query every rule is scoped by: portrait, coarse pointer, narrow. */
export declare const ADAPT_MEDIA_QUERY = "(orientation: portrait) and (max-width: 1099px)";
/**
 * Official anchors this layer keys on, most stable first.
 *
 * Exported so tests and the live audit assert the same names, and so a future
 * upstream rename fails loudly in one place instead of silently disabling a
 * rule.
 */
export declare const ANCHORS: {
    /** Semantic slot carrying the sidebar collapse toggle. */
    readonly sidebarToggle: "[data-slot=\"sidebar.brand.mark\"] button";
    /** Semantic slot wrapping the row list (rows live underneath it). */
    readonly panelList: "[data-slot=\"sidebar.panellist\"]";
    /** Semantic slot wrapping the composer. */
    readonly composer: "[data-slot=\"conversation.composer\"]";
    /** Semantic slot wrapping the conversation header. */
    readonly header: "[data-slot=\"conversation.header\"]";
    /** Official collapsed-sidebar state stamp. */
    readonly sidebarState: "[data-sidebar-collapsed]";
};
/**
 * The injected stylesheet.
 *
 * Every selector is written so a missing anchor costs one rule and never breaks
 * a layout: the \`:where()\` wrapper keeps specificity at zero, and nothing here
 * positions or sizes an element the official layout owns, except the floating
 * button, which is ours.
 * @returns CSS text.
 */
export declare function adaptCss(): string;
/**
 * The gateway-injected runtime, as a self-contained IIFE.
 *
 * Vanilla on purpose: it must run on the iPad page the gateway serves, which
 * loads no build-time imports of ours. It evaluates the same predicate as the
 * stylesheet, adds the floating sidebar entry, and wires the two gestures the
 * desktop has by other means: swipe to toggle the sidebar, long-press a session
 * row to open the menu touch cannot hover into.
 * @returns JavaScript source, ready to inline in a script tag.
 */
export declare function adaptScript(): string;
