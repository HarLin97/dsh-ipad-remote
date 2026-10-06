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

import { createElement as h } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer's Context merge (ctx.slots) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the slot map that owns LocaleNamespaceMap and the slot registry.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { installDirectoryFlow } from './picker-flow.js'
import { IpadRemoteSection } from './section.js'
import { en, zh, type IpadRemoteKey } from './locales.js'

/** Stable client-plugin name; matches the Host half and the package name. */
export const name = 'ipad-remote'

/** Services this half needs before it may register anything. */
export const inject = ['slots', 'locale']

/** Locale namespace owning every string this section renders. */
const NS = 'ipad-remote'

/** Navigation position: after the feature sections, before plugin inventory. */
const SECTION_ORDER = 60

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Remote-access section copy. */
    'ipad-remote': IpadRemoteKey
  }
}

/**
 * Register the section and its dictionaries.
 * @param ctx - owning client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ipad-remote: dictionaries')

  // Per-page, not per-boot: the desktop shell gets the directory flow (its own
  // system window), a browser gets none — and therefore no "add workspace".
  installDirectoryFlow(ctx)
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'ipad-remote',
    order: SECTION_ORDER,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t }),
  }, IpadRemoteSection))
}
