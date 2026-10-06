/**
 * "PWA remote access" — the settings section body.
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

import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import { Button, Input, Switch, Tag, Toast, type TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import { PIN_LENGTH, isValidPinFormat, type RemoteStatus } from '../contract.js'
import { createControlApi, messageOf, type ControlApi } from './api.js'
import { QrCode } from './qr-code.js'
import type { IpadRemoteKey } from './locales.js'

/** How often a mounted section re-reads the host status. */
const REFRESH_MS = 5000

/** How long the armed revoke confirmation waits for its second press. */
const CONFIRM_MS = 5000

/** Rendered edge length of an address code, in CSS pixels. */
const QR_SIZE = 148

/**
 * Section-local layout. Surfaces stay on the page layer — only the code itself
 * gets a card, because a scanner needs the light quiet zone around it.
 */
const S = {
  root: { display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '760px', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
  intro: { margin: '0 0 10px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' },
  block: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' },
  blockTitle: { margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  row: { display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 },
  grow: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: '1 1 auto' },
  label: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontWeight: 500 },
  hint: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' },
  mono: { fontFamily: 'var(--ds-font-family-code)', fontSize: '12px', overflowWrap: 'anywhere' },
  addresses: { display: 'flex', flexDirection: 'column', gap: '14px' },
  addressRow: { display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px', margin: 0, padding: 0, listStyle: 'none' },
  item: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, overflowWrap: 'anywhere' },
  pinRow: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
  pinInput: { width: '9rem' },
  actions: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
  footer: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', paddingTop: '14px', borderTop: '1px solid var(--dsw-alias-border-l2)' },
  error: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' },
  dangerButton: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
} satisfies Record<string, CSSProperties>

/** What the section knows about the host right now. */
type View =
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; status: RemoteStatus }

/** Props the settings shell injects. */
export interface IpadRemoteSectionProps {
  /** Localized copy for the `ipad-remote` namespace. */
  t: (key: IpadRemoteKey) => string
  /** Control client; tests inject a stub, the page builds the real one. */
  api?: ControlApi
}

/**
 * Render an ISO timestamp in the viewer's locale.
 * @param iso - ISO-8601 string from the host.
 * @returns a local date-time, or the raw value when it is not parseable.
 */
function formatTime(iso: string): string {
  const value = new Date(iso)
  return Number.isNaN(value.getTime()) ? iso : value.toLocaleString()
}

/**
 * The remote-access settings page.
 * @param props.t - localized copy.
 * @param props.api - control client override.
 * @returns the section element.
 */
export function IpadRemoteSection({ t, api }: IpadRemoteSectionProps) {
  const client = useMemo(() => api ?? createControlApi(), [api])
  const [view, setView] = useState<View>({ phase: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [pin, setPin] = useState('')
  const [pinTouched, setPinTouched] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)

  // The poll must not race a write, and an interval closure cannot see fresh
  // state — so the in-flight marker also lives in a ref.
  const busyRef = useRef<string | null>(null)

  const showToast = useCallback((text: string) => {
    setToast(current => ({ text, seq: (current?.seq ?? 0) + 1 }))
  }, [])

  const load = useCallback(async (silent: boolean) => {
    try {
      const status = await client.status()
      setView({ phase: 'ready', status })
      setStale(false)
    } catch (error) {
      // A failed background poll keeps the last good data on screen and says so;
      // a failed first or explicit load replaces the page.
      if (silent) {
        setStale(true)
        return
      }
      setView({ phase: 'failed', message: messageOf(error) })
    }
  }, [client])

  useEffect(() => { void load(false) }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current === null) void load(true)
    }, REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [load])

  useEffect(() => {
    if (!confirmingRevoke) return undefined
    const timer = setTimeout(() => { setConfirmingRevoke(false) }, CONFIRM_MS)
    return () => { clearTimeout(timer) }
  }, [confirmingRevoke])

  /**
   * Run one write, then refresh from the host's real answer.
   * @param name - in-flight marker shown by disabled controls.
   * @param action - the control call.
   * @param success - toast copy on success.
   * @returns whether the write succeeded.
   */
  const run = useCallback(async (
    name: string,
    action: () => Promise<RemoteStatus>,
    success?: string,
  ): Promise<boolean> => {
    busyRef.current = name
    setBusy(name)
    setActionError(null)
    try {
      const status = await action()
      setView({ phase: 'ready', status })
      setStale(false)
      if (success !== undefined) showToast(success)
      return true
    } catch (error) {
      setActionError(messageOf(error))
      return false
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }, [showToast])

  const status = view.phase === 'ready' ? view.status : undefined
  const busyNow = busy !== null
  const pinValid = isValidPinFormat(pin)
  const showPinError = pinTouched && pin !== '' && !pinValid

  const onToggle = (next: boolean): void => {
    void run('enable', () => client.setEnabled(next), next ? t('enabledToast') : t('disabledToast'))
  }

  const onSavePin = (): void => {
    setPinTouched(true)
    if (!pinValid) return
    void run('pin', () => client.setPin(pin), t('pinSaved')).then(saved => {
      if (saved) {
        setPin('')
        setPinTouched(false)
      }
    })
  }

  const onRevoke = (): void => {
    if (!confirmingRevoke) {
      setConfirmingRevoke(true)
      return
    }
    setConfirmingRevoke(false)
    void run('revoke', () => client.revoke(), t('revoked'))
  }

  const onCopy = (url: string): void => {
    const clipboard = globalThis.navigator?.clipboard
    if (clipboard === undefined) {
      setActionError(t('copyFailed'))
      return
    }
    void clipboard.writeText(url).then(
      () => { showToast(t('copied')) },
      () => { setActionError(t('copyFailed')) },
    )
  }

  const stateTag = status === undefined
    ? null
    : !status.enabled
      ? { tone: 'quiet' as TagTone, text: t('stopped') }
      : status.listening
        ? { tone: 'success' as TagTone, text: t('listening') }
        : { tone: 'danger' as TagTone, text: t('portBusy') }

  return h('div', { style: S.root },
    h('p', { style: S.intro }, t('intro')),
    stale ? h('p', { style: S.error, role: 'status' }, t('staleWarning')) : null,
    view.phase === 'loading' ? h('p', { style: S.hint, role: 'status' }, t('loading')) : null,
    view.phase === 'failed'
      ? h('div', { style: S.block },
          h('p', { style: S.error, role: 'alert' }, `${t('loadFailed')}：${view.message}`),
          h(Button, { size: 'sm', variant: 'outline', onClick: () => { void load(false) } }, t('retry')))
      : null,

    status === undefined ? null : h('div', { style: S.block },
      h('h3', { style: S.blockTitle }, t('enableLabel')),
      h('div', { style: S.row },
        h('div', { style: S.grow },
          h('div', { style: S.label }, stateTag === null ? null : h(Tag, { tone: stateTag.tone }, stateTag.text)),
          h('p', { style: S.hint }, status.enabled && !status.listening ? t('portBusyHint') : t('enableHint'))),
        h(Switch, {
          checked: status.enabled,
          disabled: busyNow,
          label: t('enableLabel'),
          onChange: onToggle,
        }))),

    status === undefined ? null : h('div', { style: S.block },
      h('h3', { style: S.blockTitle }, t('pinTitle')),
      h('div', { style: S.label }, h(Tag, { tone: status.hasPin ? 'success' : 'warning' }, status.hasPin ? t('pinSet') : t('pinUnset'))),
      // The PIN is held in memory for this run only, so it can be revealed here
      // exactly when this process set it. After a restart the card says why not.
      status.currentPin === undefined
        ? (status.hasPin ? h('p', { style: S.hint }, t('pinUnknown')) : null)
        : h('div', { style: S.pinRow },
          h('span', { style: S.hint }, t('pinCurrent')),
          h('code', { style: S.mono }, showPin ? status.currentPin : '••••••'),
          h(Button, {
            disabled: busyNow,
            onClick: () => { setShowPin(value => !value) },
          }, showPin ? t('pinHide') : t('pinReveal'))),
      h('div', { style: S.pinRow },
        h(Input, {
          type: 'password',
          inputMode: 'numeric',
          autoComplete: 'off',
          maxLength: PIN_LENGTH,
          value: pin,
          placeholder: t('pinPlaceholder'),
          'aria-label': t('pinLabel'),
          'aria-invalid': showPinError,
          disabled: busyNow,
          style: S.pinInput,
          onChange: (event: ChangeEvent<HTMLInputElement>) => {
            setPin(event.target.value.replace(/[^0-9]/g, ''))
            setPinTouched(true)
          },
        }),
        h(Button, {
          variant: 'primary',
          disabled: busyNow || !pinValid,
          onClick: onSavePin,
        }, t('pinSave'))),
      showPinError ? h('p', { style: S.error, role: 'alert' }, t('pinInvalid')) : null,
      h('p', { style: S.hint }, t('pinHint'))),

    status === undefined ? null : h('div', { style: S.block },
      h('h3', { style: S.blockTitle }, t('addressesTitle')),
      status.addresses.length === 0
        ? h('p', { style: S.hint }, t('addressesEmpty'))
        : h('div', { style: S.addresses }, ...status.addresses.map(entry => h('div', { key: entry.url, style: S.addressRow },
            h('div', { style: S.grow },
              h('div', { style: S.label }, entry.label, h(Tag, { tone: 'outline' }, entry.iface)),
              h('div', { style: S.mono }, entry.url),
              h('div', null, h(Button, {
                size: 'sm',
                variant: 'outline',
                'aria-label': `${t('copy')}：${entry.url}`,
                onClick: () => { onCopy(entry.url) },
              }, t('copy')))),
            h(QrCode, { text: entry.url, label: `${t('qrLabel')}：${entry.url}`, size: QR_SIZE })))),
      h('p', { style: S.hint }, t('addressesHint')),
      h('p', { style: S.hint }, t('addressesInstallHint'))),

    status === undefined ? null : h('div', { style: S.block },
      h('h3', { style: S.blockTitle }, t('sessionsTitle')),
      status.sessions.length === 0
        ? h('p', { style: S.hint }, t('sessionsEmpty'))
        : h('ul', { style: S.list }, ...status.sessions.map((session, index) => h('li', {
            key: `${session.issuedAt}-${String(index)}`,
            style: S.item,
          },
            h('span', null, session.label),
            h('span', { style: S.hint }, `${t('issuedAt')} ${formatTime(session.issuedAt)} · ${t('expiresAt')} ${formatTime(session.expiresAt)}`)))),
      status.sessions.length === 0 ? null : h('div', { style: S.actions },
        h(Button, {
          size: 'sm',
          variant: 'outline',
          style: confirmingRevoke ? S.dangerButton : undefined,
          disabled: busyNow,
          onClick: onRevoke,
        }, confirmingRevoke ? t('revokeConfirm') : t('revoke')))),

    actionError === null ? null : h('p', { style: S.error, role: 'alert' }, `${t('actionFailed')}：${actionError}`),

    status === undefined ? null : h('div', { style: S.footer },
      h('span', { style: S.hint }, `${t('storePath')}：${status.storePath}`),
      h(Button, { size: 'sm', variant: 'ghost', disabled: busyNow, onClick: () => { void load(false) } }, t('refresh'))),

    toast === null ? null : h(Toast, {
      key: toast.seq,
      text: toast.text,
      tone: 'success',
      onDone: () => { setToast(null) },
    }),
  )
}
