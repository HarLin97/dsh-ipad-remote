import { describe, expect, it } from 'vitest'
import { PIN_LENGTH } from '../src/store.js'
import { LOGOUT_PATH, UNLOCK_PATH, escapeHtml, renderUnlockPage } from '../src/unlock-page.js'

describe('escapeHtml', () => {
  it('neutralizes every dangerous character', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>'))
      .toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;')
  })
})

describe('renderUnlockPage', () => {
  it('renders a usable form with an accessible label', () => {
    const html = renderUnlockPage()
    expect(html).toContain(`action="${UNLOCK_PATH}"`)
    expect(html).toContain('method="post"')
    expect(html).toContain('for="pin"')
    expect(html).toContain('id="pin"')
    expect(html).toContain(`maxlength="${String(PIN_LENGTH)}"`)
  })

  it('works on an iPad without internet access', () => {
    const html = renderUnlockPage()
    expect(html).not.toMatch(/src=["']https?:/)
    expect(html).not.toMatch(/href=["']https?:/)
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('safe-area-inset-bottom')
  })

  it('shows no error block by default', () => {
    expect(renderUnlockPage()).not.toContain('role="alert"')
  })

  it('announces an error and escapes it', () => {
    const html = renderUnlockPage({ error: '<img onerror=alert(1)>' })
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('<img')
  })

  it('includes a retry hint when throttled', () => {
    expect(renderUnlockPage({ error: '稍后重试', retryAfterSeconds: 30 })).toContain('30 秒后重试')
  })

  it('exposes the logout path constant', () => {
    expect(LOGOUT_PATH).toBe('/__ipad-remote/logout')
  })
})
