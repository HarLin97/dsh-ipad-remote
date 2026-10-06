/**
 * Register the workspace directory flow only where it can actually run.
 *
 * Upstream picks one directory-picker backend per boot, and that single choice
 * serves both the desktop shell and every remote browser:
 * - the official adaptive chooser mounts the native surface, which uses the
 *   Electron bridge when the page has it and otherwise asks the host — so on a
 *   phone the system window opens on the PC screen, where nobody can reach it;
 * - pinning the browsing surface instead moves the desktop off its own window.
 *
 * This deployment wants the desktop system window AND no unusable offer on a
 * remote client. ui-workspace decides that offer by asking whether anybody
 * occupies the directory-flow slot, so the decision can be made per PAGE instead
 * of per boot: the Electron shell exposes `__DSH_DIRECTORY_PICKER__`, a browser
 * does not, and registering NOTHING is what removes the entry.
 * @module @harlin97/dsh-ipad-remote/client/picker-flow
 */

import { useEffect, useRef } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the renderer owns the `slots` service (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the slot registry that owns SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Global the desktop shell preloads; absent in every browser. */
export const DIRECTORY_BRIDGE_GLOBAL = '__DSH_DIRECTORY_PICKER__'

/** The Electron shell directory bridge. */
export interface DirectoryPickerBridge {
  /** Open the system folder window; resolves the chosen path, or null on cancel. */
  pick: () => Promise<string | null>
}

/** Owner-provided props of a directory-flow occupant. */
export interface DirectoryFlowOwnerProps {
  /** Whether this flow is the one currently asking. */
  open: boolean
  /** Adopt a directory. */
  onPicked: (path: string) => void
  /** The user dismissed the chooser. */
  onCancel: () => void
  /** The chooser failed. */
  onError: (message: string) => void
}

/** What this plugin injects into the occupant. */
export interface DirectoryFlowInject {
  /** Run one pick through the desktop bridge. */
  pick: () => Promise<string | null>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Hero-side directory flow, owned by ui-workspace. */
    'conversation.hero.workspace.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
    /** Sidebar-side directory flow, owned by ui-workspace. */
    'sidebar.workspaces.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
  }
}

/**
 * Read the desktop bridge from a global scope.
 * @param scope - object to inspect; defaults to the page global, injectable for tests.
 * @returns the bridge, or undefined in any browser.
 */
export function desktopBridge(
  scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): DirectoryPickerBridge | undefined {
  const candidate = scope[DIRECTORY_BRIDGE_GLOBAL]
  if (typeof candidate !== "object" || candidate === null) return undefined
  const pick = (candidate as { pick?: unknown }).pick
  if (typeof pick !== "function") return undefined
  return { pick: pick as () => Promise<string | null> }
}

/**
 * Renderless occupant: one pick per rising `open` edge, one outcome reported.
 *
 * The shape mirrors the upstream native occupant, because that is what the
 * ui-workspace owner drives: it raises `open`, then expects exactly one of
 * onPicked / onCancel / onError.
 * @param props - owner props plus the injected pick.
 * @returns nothing; the system window renders on this machine display.
 */
export function DesktopDirectoryFlow(props: DirectoryFlowOwnerProps & DirectoryFlowInject): null {
  const { open, pick } = props
  const armed = useRef(false)
  const outcome = useRef(props)
  outcome.current = props
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!open) {
      armed.current = false
      return
    }
    if (armed.current) return
    armed.current = true
    pick().then(path => {
      if (!alive.current) return
      if (path === null) outcome.current.onCancel()
      else outcome.current.onPicked(path)
    }, reason => {
      if (!alive.current) return
      outcome.current.onError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [open, pick])
  return null
}

/**
 * Occupy both directory-flow slots when the desktop bridge exists.
 *
 * A browser registers nothing on purpose. With the slot empty, ui-workspace
 * reports the flow as unavailable and never renders the "add workspace" entry,
 * so a remote client picks among workspaces that already exist — which is the
 * whole of what choosing a folder remotely can be here.
 * @param ctx - owning client plugin context.
 */
export function installDirectoryFlow(ctx: ClientContext): void {
  const bridge = desktopBridge()
  if (bridge === undefined) return
  const pick = (): Promise<string | null> => bridge.pick()
  const injected = (): DirectoryFlowInject => ({ pick })
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', inject: injected }, DesktopDirectoryFlow)
      yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', inject: injected }, DesktopDirectoryFlow)
    }))
}
