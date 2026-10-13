export type OAuthOutcome =
  | { status: 'complete'; planEnabled: boolean; backgroundAllowed: boolean }
  | { status: 'error' | 'cancelled' };

/** Keeps the website's dot identity with opaque, raised content surfaces; no remote assets or scripts. */
export const OAUTH_PAGE_STYLE = `
:root{color-scheme:dark;--plate:#0b0b0c;--surface:#1c1c1e;--line-1:rgb(255 255 255 / .08);--line-2:rgb(255 255 255 / .12);--fg-1:#f5f5f7;--fg-2:#b2b2b8;--fg-3:#96969c;--dot-0:rgb(255 255 255 / .1);--font-text:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:48px 24px;background-color:var(--plate);background-image:radial-gradient(circle,var(--dot-0) 1px,transparent 1.5px);background-size:24px 24px;background-position:calc(50% + 12px) 12px;color:var(--fg-1);font:17px/1.47 var(--font-text);-webkit-font-smoothing:antialiased}
main{width:100%;max-width:624px}header{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:40px;font-size:14px;font-weight:600}.mark{display:grid;place-items:center;width:28px;height:28px}
.symbol{display:grid;place-items:center;width:88px;height:88px;margin:0 auto 24px;border:1px solid var(--line-2);border-radius:20px;background:var(--surface)}
h1{font-size:clamp(30px,5vw,44px);line-height:1.15;letter-spacing:-.01em;margin:0 0 20px;font-weight:700;text-align:center;background-image:radial-gradient(circle,var(--fg-1) 0 44%,transparent 50%);background-size:3px 3px;background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{margin:0;color:var(--fg-2)}.lede{max-width:560px;margin-inline:auto;text-align:center;line-height:1.6}html:lang(zh) h1{letter-spacing:0;font-weight:600}
dl{margin:32px 0 0;padding:4px 24px;background:var(--surface);border:1px solid var(--line-1);border-radius:20px}
.row{display:flex;justify-content:space-between;gap:24px;padding:16px 0}.row+.row{border-top:1px solid var(--line-1)}dt{color:var(--fg-2);font-size:14px}dd{margin:0;text-align:right;font-size:14px;font-weight:500}
footer{margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--fg-3)}
a{display:inline-flex;align-items:center;gap:6px;min-height:44px;color:var(--fg-1);text-underline-offset:4px;border-radius:10px}a:active{opacity:.6}a:focus-visible{outline:2px solid var(--fg-1);outline-offset:4px}
@media(hover:hover) and (pointer:fine){a:hover{opacity:.8}}
@media(prefers-contrast:more){:root{--fg-2:var(--fg-1);--fg-3:var(--fg-1);--line-1:rgb(255 255 255 / .32);--line-2:rgb(255 255 255 / .5)}h1{background:none;-webkit-text-fill-color:currentColor}}
@media(forced-colors:active){body{background:none}h1{background:none;-webkit-text-fill-color:currentColor}.symbol,dl{border-color:CanvasText}}
@media(max-width:420px){body{padding:32px 24px}header{margin-bottom:32px}dl{padding:4px 16px}footer{justify-content:center;text-align:center}}
`;

const copy = {
  en: {
    connected: 'ChatGPT is connected',
    identity: 'Signed in to ChatGPT',
    failed: 'Couldn’t finish connecting',
    cancelled: 'Sign-in cancelled',
    ready: 'Atd can now use your ChatGPT plan for the tasks you start.',
    limited: 'Your account is signed in. ChatGPT plan usage hasn’t been enabled for Atd.',
    error: 'No new connection was completed. Return to Atd to see the details and try again.',
    cancel: 'Return to Atd whenever you’re ready to connect your account.',
    account: 'Account',
    signedIn: 'Signed in',
    plan: 'ChatGPT plan',
    enabled: 'Enabled',
    disabled: 'Not enabled',
    background: 'Background use',
    allowed: 'Allowed',
    off: 'Off',
    local: 'Credentials stay in your macOS keychain.',
    usage: 'Manage ChatGPT usage',
  },
  'zh-CN': {
    connected: 'ChatGPT 已连接',
    identity: '已登录 ChatGPT',
    failed: '未能完成连接',
    cancelled: '已取消登录',
    ready: 'Atd 现在可以使用你的 ChatGPT 订阅额度，完成你发起的任务。',
    limited: '账号登录成功，但尚未向 Atd 开放 ChatGPT 订阅额度。',
    error: '本次连接未完成。请返回 Atd 查看详细信息，然后重试。',
    cancel: '准备好连接账号时，随时可以返回 Atd 重新登录。',
    account: '账号',
    signedIn: '已登录',
    plan: '订阅额度',
    enabled: '已启用',
    disabled: '未启用',
    background: '后台调用',
    allowed: '已允许',
    off: '已关闭',
    local: '凭据保存在本机 macOS 钥匙串中。',
    usage: '管理 ChatGPT 用量',
  },
};

export function oauthPage(outcome: OAuthOutcome, language: 'en' | 'zh-CN' = 'en'): string {
  const t = copy[language];
  const complete = outcome.status === 'complete';
  const plan = complete && outcome.planEnabled;
  const title = complete
    ? plan
      ? t.connected
      : t.identity
    : outcome.status === 'cancelled'
      ? t.cancelled
      : t.failed;
  const description = complete
    ? plan
      ? t.ready
      : t.limited
    : outcome.status === 'cancelled'
      ? t.cancel
      : t.error;
  const rows = complete
    ? `<dl>
    <div class="row"><dt>${t.account}</dt><dd>${t.signedIn}</dd></div>
    <div class="row"><dt>${t.plan}</dt><dd>${plan ? t.enabled : t.disabled}</dd></div>
    <div class="row"><dt>${t.background}</dt><dd>${plan && outcome.backgroundAllowed ? t.allowed : t.off}</dd></div>
  </dl>`
    : '';
  // Only fixed application copy is rendered. Never echo tokens, account data or callback errors.
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Atd</title>
  <style>${OAUTH_PAGE_STYLE}</style></head><body><main>
  <header><span class="mark" aria-hidden="true"><svg width="26" height="26" viewBox="18 18 84 84" fill="currentColor"><path d="M60 60H39A21 21 0 1 1 60 39Z"/><path d="M60 60H81A21 21 0 1 1 60 81Z"/></svg></span>Atd <span aria-hidden="true">/</span> ChatGPT</header>
  <div class="symbol" aria-hidden="true">${statusDots(complete)}</div>
  <h1>${title}</h1><p class="lede">${description}</p>${rows}
  <footer>${complete ? `<span>${t.local}</span>` : ''}<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">${t.usage}<span aria-hidden="true">↗</span></a></footer>
  </main></body></html>`;
}

/** The site's LED board idiom, with a static check or cross for reduced-motion parity. */
function statusDots(complete: boolean): string {
  const check = new Set(['2,5', '3,6', '4,7', '5,6', '6,5', '7,4', '8,3']);
  const dots = Array.from({ length: 121 }, (_, index) => {
    const x = index % 11;
    const y = Math.floor(index / 11);
    const lit = complete ? check.has(`${x},${y}`) : x >= 3 && x <= 7 && (x === y || x + y === 10);
    return `<circle cx="${4 + x * 8}" cy="${4 + y * 8}" r="${lit ? 2.5 : 1}" fill="${lit ? 'var(--fg-1)' : 'var(--dot-0)'}"/>`;
  }).join('');
  return `<svg width="86" height="86" viewBox="0 0 88 88" fill="none">${dots}</svg>`;
}
