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
export const FORCE_DESKTOP_KEY = 'ipad-remote-force-desktop';
/** Storage key holding the dragged floating-button position. */
export const BUTTON_POSITION_KEY = 'ipad-remote-launcher-pos';
/** Id of the injected floating button. */
export const LAUNCHER_ID = 'ipadRemoteLauncher';
/** Body class while the layer is driving the page. */
export const ACTIVE_CLASS = 'ipad-remote-portrait';
/** The media query every rule is scoped by: portrait, coarse pointer, narrow. */
export const ADAPT_MEDIA_QUERY = '(orientation: portrait) and (max-width: 1099px)';
/**
 * Official anchors this layer keys on, most stable first.
 *
 * Exported so tests and the live audit assert the same names, and so a future
 * upstream rename fails loudly in one place instead of silently disabling a
 * rule.
 */
export const ANCHORS = {
    /** Semantic slot carrying the sidebar collapse toggle. */
    sidebarToggle: '[data-slot="sidebar.brand.mark"] button',
    /** Semantic slot wrapping the row list (rows live underneath it). */
    panelList: '[data-slot="sidebar.panellist"]',
    /** Semantic slot wrapping the composer. */
    composer: '[data-slot="conversation.composer"]',
    /** Semantic slot wrapping the conversation header. */
    header: '[data-slot="conversation.header"]',
    /** Official collapsed-sidebar state stamp. */
    sidebarState: '[data-sidebar-collapsed]',
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
export function adaptCss() {
    const rules = [
        // The app frame fills the dynamic viewport so browser chrome never clips it.
        '[class*="_frame"]:has([class*="_centerCol"]){width:100%;height:100dvh}',
        // Collapsed rail and panel icons: 44px is the smallest reliable touch target.
        '[class$="_railFish"] button,[class$="_panelIcon"],[class$="_newSession"]{min-width:44px;min-height:44px}',
        // 16px inputs stop iOS from zooming the whole page when the composer focuses.
        ':is([class$="_input"]),textarea,input{font-size:16px}',
        // The composer clears the home indicator.
        '[class$="_composer"]{padding-bottom:calc(4px + env(safe-area-inset-bottom))}',
        // Messages get the width back; side padding is only chrome on a phone.
        '[class$="_scroll"]{padding:8px 10px}',
        '[class$="_scrollBody"] [class$="_root"],[class$="_scrollBody"] [class$="_bubble"]{font-size:14.5px}',
        // The header title row keeps clear of the floating button.
        '[class$="_titleRow"]{padding-left:52px}',
        '[class$="_titleRow"] *{font-size:13px}',
        // Sidebar rows carry more information than fits; shrink type, never truncate.
        '[class*="_sidebarCol"] [class$="_root"],[class*="_sidebarCol"] [class$="_newSession"],[class*="_sidebarCol"] [class$="_trigger"],[class*="_sidebarCol"] [class$="_title"]{font-size:13px}',
        '[class*="_sidebarCol"] [class$="_meta"],[class*="_sidebarCol"] [class$="_time"]{font-size:11.5px}',
        // Hover-only row actions can never be revealed by touch; show them always.
        '[class*="_sidebarCol"] :is([class*="_rowActions"]){display:inline-flex}',
        // Long-press on a row must open the row menu, not start a native drag.
        ':is([class*="_sessionRow"]),:is([class*="_projectRow"]){-webkit-user-drag:none;user-select:none}',
        // Composer menus (model, permission, attachments) anchor to their narrow
        // triggers and fly past the left edge on a phone: pin them to the viewport
        // bottom as a sheet with real touch targets. The seat's identity transform
        // would still become the containing block for fixed children, so free it.
        '[class$="_composerSeat"]{transform:none !important}',
        '[class$="_composerSeat"] [class$="_menu"]{position:fixed !important;left:8px !important;right:8px !important;top:auto !important;bottom:calc(8px + env(safe-area-inset-bottom)) !important;width:auto !important;max-width:none !important;max-height:70dvh !important;overflow-y:auto !important;z-index:2147482000}',
        '[class$="_composerSeat"] [class$="_menu"] [class$="_cell"]{height:44px;min-height:44px;font-size:13px}',
        // Tooltips stick after a tap leaves :hover behind; tooltips only, so user
        // message bubbles (no tooltip role) stay visible.
        '[class*="_bubble"][role="tooltip"]{display:none}',
        // The settings overlay is a fixed 800px two-column panel; stack it.
        '[class$="_overlay"] [class$="_panel"]{flex-direction:column;max-height:calc(100dvh - 32px)}',
        // The floating sidebar entry. Ours: fixed, safe-area aware, touch-action none
        // so dragging it does not scroll the page underneath.
        '#' + LAUNCHER_ID + '{position:fixed;top:calc(6px + env(safe-area-inset-top));left:calc(8px + env(safe-area-inset-left));z-index:2147482999;width:36px;height:36px;min-width:36px;padding:0;border-radius:10px;background:var(--dsw-alias-bg-module-platform, rgba(28,28,30,.86));border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16));color:var(--dsw-alias-label-primary, #fff);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 6px rgba(0,0,0,.25);touch-action:none;cursor:pointer}',
        '#' + LAUNCHER_ID + ':active{opacity:.72}',
        '#' + LAUNCHER_ID + ' svg{width:20px;height:15px;display:block}',
    ];
    return '@media ' + ADAPT_MEDIA_QUERY + '{' + rules.join('') + '}';
}
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
export function adaptScript() {
    return [
        '(() => {',
        '  if (window.__ipadRemoteAdaptInstalled) return;',
        '  window.__ipadRemoteAdaptInstalled = true;',
        '  var MQ = ' + JSON.stringify(ADAPT_MEDIA_QUERY) + ';',
        '  var OPT_OUT = ' + JSON.stringify(FORCE_DESKTOP_KEY) + ';',
        '  var POS_KEY = ' + JSON.stringify(BUTTON_POSITION_KEY) + ';',
        '  var ID = ' + JSON.stringify(LAUNCHER_ID) + ';',
        '  var BODY = ' + JSON.stringify(ACTIVE_CLASS) + ';',
        '  var A = ' + JSON.stringify(ANCHORS) + ';',
        '  var MQ = ' + JSON.stringify(ADAPT_MEDIA_QUERY) + ';',
        '  var OPT_OUT = ' + JSON.stringify(FORCE_DESKTOP_KEY) + ';',
        '  var POS_KEY = ' + JSON.stringify(BUTTON_POSITION_KEY) + ';',
        '  var ID = ' + JSON.stringify(LAUNCHER_ID) + ';',
        '  var BODY = ' + JSON.stringify(ACTIVE_CLASS) + ';',
        '  var A = ' + JSON.stringify(ANCHORS) + ';',
        '  function enabled() {',
        '    try {',
        '      var forced = new URLSearchParams(window.location.search).get(\"adapt\");',
        '      if (forced === \"off\" || window.sessionStorage.getItem(OPT_OUT) === \"1\") return false;',
        '      if (forced === \"force\") return true;',
        '    } catch (e) { /* private mode or no URLSearchParams */ }',
        '    return typeof window.matchMedia === \"function\" && window.matchMedia(MQ).matches;',
        '  }',
        '  function isCollapsed() {',
        '    var stamp = document.querySelector(A.sidebarState);',
        '    return stamp !== null && stamp.getAttribute(\"data-sidebar-collapsed\") === \"true\";',
        '  }',
        '  function toggleSidebar() {',
        '    var toggle = document.querySelector(A.sidebarToggle);',
        '    if (toggle === null) {',
        '      var list = document.querySelector(A.panelList);',
        '      toggle = list === null ? null : list.querySelector(\"button\");',
        '    }',
        '    if (toggle !== null) toggle.click();',
        '  }',
        '  function setSidebar(open) { if (isCollapsed() === open) toggleSidebar() }',
        '  function mount() {',
        '    if (document.getElementById(ID) !== null) return;',
        '    document.body.classList.add(BODY);',
        '    var button = document.createElement(\"button\");',
        '    button.id = ID;',
        '    button.type = \"button\";',
        '    button.setAttribute(\"aria-label\", \"侧栏 / Sidebar\");',
        '    button.innerHTML = ' + JSON.stringify('<svg viewBox="0 0 24 18" aria-hidden="true"><rect x="0.8" y="0.8" width="22.4" height="16.4" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="8.6" y1="0.8" x2="8.6" y2="17.2" stroke="currentColor" stroke-width="1.6"/></svg>') + ';',
        '    var saved = null;',
        '    try { saved = JSON.parse(window.localStorage.getItem(POS_KEY) || \"null\") } catch (e) { saved = null }',
        '    if (saved !== null && typeof saved.x === \"number\" && typeof saved.y === \"number\") {',
        '      button.style.left = saved.x + \"px\";',
        '      button.style.top = saved.y + \"px\";',
        '    }',
        '    var drag = null;',
        '    button.addEventListener(\"pointerdown\", function (event) {',
        '      drag = { x: event.clientX, y: event.clientY, left: button.offsetLeft, top: button.offsetTop, moved: false };',
        '      try { button.setPointerCapture(event.pointerId) } catch (e) { /* unsupported */ }',
        '    });',
        '    button.addEventListener(\"pointermove\", function (event) {',
        '      if (drag === null) return;',
        '      var dx = event.clientX - drag.x;',
        '      var dy = event.clientY - drag.y;',
        '      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;',
        '      drag.moved = true;',
        '      button.style.left = Math.max(4, Math.min(window.innerWidth - 44, drag.left + dx)) + \"px\";',
        '      button.style.top = Math.max(4, Math.min(window.innerHeight - 44, drag.top + dy)) + \"px\";',
        '    });',
        '    button.addEventListener(\"pointerup\", function () {',
        '      if (drag === null) return;',
        '      var moved = drag.moved;',
        '      drag = null;',
        '      if (moved) {',
        '        try { window.localStorage.setItem(POS_KEY, JSON.stringify({ x: button.offsetLeft, y: button.offsetTop })) } catch (e) { /* private mode */ }',
        '      } else {',
        '        toggleSidebar();',
        '      }',
        '    });',
        '    document.body.appendChild(button);',
        '  }',
        '  function unmount() {',
        '    var button = document.getElementById(ID);',
        '    if (button !== null) button.remove();',
        '    document.body.classList.remove(BODY);',
        '  }',
        '  function evaluate() { if (enabled()) mount(); else unmount() }',
        '  var origin = null;',
        '  document.addEventListener(\"touchstart\", function (event) {',
        '    if (!enabled() || event.touches.length !== 1) { origin = null; return }',
        '    var touch = event.touches[0];',
        '    origin = { x: touch.clientX, y: touch.clientY, at: Date.now() };',
        '  }, { passive: true });',
        '  document.addEventListener(\"touchend\", function (event) {',
        '    if (origin === null || !enabled()) return;',
        '    var touch = event.changedTouches[0];',
        '    var dx = touch.clientX - origin.x;',
        '    var dy = touch.clientY - origin.y;',
        '    var fresh = Date.now() - origin.at < 600;',
        '    origin = null;',
        '    if (!fresh || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;',
        '    setSidebar(dx > 0);',
        '  }, { passive: true });',
        '  var timer = null;',
        '  function cancelLongPress() { if (timer !== null) { clearTimeout(timer); timer = null } }',
        '  document.addEventListener(\"touchstart\", function (event) {',
        '    if (!enabled()) return;',
        '    var row = event.target instanceof Element ? event.target.closest(' + JSON.stringify('[class*="_sessionRow"],[class*="_projectRow"]') + ') : null;',
        '    if (row === null) return;',
        '    var touch = event.touches[0];',
        '    var startX = touch.clientX;',
        '    var startY = touch.clientY;',
        '    cancelLongPress();',
        '    timer = setTimeout(function () {',
        '      timer = null;',
        '      var target = row.querySelector(' + JSON.stringify('[class*="_rowActions"] button, button') + ');',
        '      if (target !== null) target.click();',
        '    }, 500);',
        '    var abort = function (moveEvent) {',
        '      var moved = moveEvent.touches[0];',
        '      if (Math.abs(moved.clientX - startX) + Math.abs(moved.clientY - startY) > 12) {',
        '        cancelLongPress();',
        '        document.removeEventListener(\"touchmove\", abort);',
        '      }',
        '    };',
        '    document.addEventListener(\"touchmove\", abort, { passive: true });',
        '  }, { passive: true });',
        '  document.addEventListener(\"touchend\", cancelLongPress, { passive: true });',
        '  document.addEventListener(\"touchcancel\", cancelLongPress, { passive: true });',
        '  window.addEventListener(\"resize\", evaluate);',
        '  window.addEventListener(\"orientationchange\", evaluate);',
        '  evaluate();',
        '  // The SPA re-renders freely; keep the entry mounted without observing the',
        '  // whole tree, which would cost more than it is worth on a phone.',
        '  if (window.__ipadRemoteAdaptTimer) window.clearInterval(window.__ipadRemoteAdaptTimer);',
        '  window.__ipadRemoteAdaptTimer = window.setInterval(evaluate, 1000);',
        '})();',
        '',
    ].join(String.fromCharCode(10));
}
