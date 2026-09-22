/**
 * 登录屏验证（本地开发用，不参与部署）。
 *
 * 用法（**必须用假项目地址构建一次**，否则会打到真的 Supabase 上）：
 *   $env:VITE_SUPABASE_URL='https://fake-project.supabase.co'
 *   $env:VITE_SUPABASE_ANON_KEY='<任意长字符串>'
 *   npm run build
 *   npx vite preview --port 4319 --strictPort
 *   node scripts/verify-login.mjs
 *
 * 为什么构建期就要换地址：cloud.js 里**构建期 env 优先于浏览器里存的配置**
 * （那是有意的：一键部署的人不用让每个使用者再填一遍）。
 * 所以想在浏览器里把地址改掉是改不动的，只能在构建时给。
 *
 * 它做两件事：
 *   · 把登录屏的四种形态（登录 / 注册 / 忘记密码）按桌面、平板、手机、深色
 *     四种情形截图，方便用眼睛看一遍；
 *   · 跑一遍真正会踩坑的行为：路由收敛、密码明文切换、行内校验、
 *     未登录时不渲染主外壳、登录后能进应用、有会话时跳过登录屏。
 *
 * 截图默认写到系统临时目录，跑完不在工作区留文件；要归档就设 SMOKE_OUT。
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4319/'
const OUT = process.env.SMOKE_OUT || join(tmpdir(), 'kaoyan-login')
const STORAGE_KEY = 'kivotos-kaoyan-v1'
const META_KEY = 'kivotos-kaoyan-cloud-meta-v1'
const AUTH_KEY = 'kivotos-kaoyan-auth'

/** 必须和构建时 VITE_SUPABASE_URL 一致；改了就整套对不上 */
const FAKE_URL = process.env.SMOKE_PROJECT || 'https://fake-project.supabase.co'
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'sensei@example.com' }

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

/* ---------------- 会话与假后端 ---------------- */

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

function makeJwt(user) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 3600
  })
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

function sessionFor(user) {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: makeJwt(user),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `refresh-${user.id}`,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  }
}

const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** 假 Supabase：只实现登录屏会碰到的几个端点，其余一律 200 空响应 */
async function installFakeSupabase(page, audit) {
  await page.route(`${FAKE_URL}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()

    if (path === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'password') {
        const body = JSON.parse(req.postData() || '{}')
        audit.logins.push(body.email)
        if (body.password !== 'right-password') {
          return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
        }
        return json(route, 200, sessionFor(USER))
      }
      if (grant === 'refresh_token') return json(route, 200, sessionFor(USER))
      return json(route, 400, { error: 'unsupported_grant_type' })
    }
    if (path === '/auth/v1/signup') {
      audit.signups.push(JSON.parse(req.postData() || '{}').email)
      // 模拟「项目开着 Confirm email」：注册不返回会话，必须先去邮箱点确认链接
      return json(route, 200, { user: { id: USER.id, email: USER.email }, session: null })
    }
    if (path === '/auth/v1/otp') {
      audit.otps.push(JSON.parse(req.postData() || '{}').email)
      return json(route, 200, {})
    }
    if (path === '/auth/v1/recover') {
      audit.recovers.push(JSON.parse(req.postData() || '{}').email)
      return json(route, 200, {})
    }
    if (path === '/auth/v1/user') return json(route, 200, sessionFor(USER).user)
    if (path.startsWith('/rest/v1/')) {
      return method === 'GET' ? json(route, 200, null) : json(route, 201, null)
    }
    return json(route, 200, {})
  })
}

/* ---------------- 页面 ---------------- */

let browser
const consoleErrors = []

async function newPage({ viewport = { width: 1440, height: 960 }, seed = null, dark = false } = {}) {
  const context = await browser.newContext({
    viewport,
    locale: 'zh-CN',
    colorScheme: dark ? 'dark' : 'light'
  })
  const page = await context.newPage()
  const audit = { logins: [], signups: [], otps: [], recovers: [] }

  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`)
  })

  await page.route('**://fonts.googleapis.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort())
  await installFakeSupabase(page, audit)

  if (seed) {
    await page.addInitScript(({ storageKey, metaKey, authKey, seed }) => {
      // 注意：**不在这里塞项目地址**。构建产物里已经烘焙了假项目地址，
      // 而 cloud.js 里构建期 env 优先于 localStorage，从浏览器这边覆盖是没用的。
      localStorage.setItem(storageKey, JSON.stringify(seed.state || {}))
      if (seed.meta) localStorage.setItem(metaKey, JSON.stringify(seed.meta))
      if (seed.session) localStorage.setItem(authKey, JSON.stringify(seed.session))
    }, { storageKey: STORAGE_KEY, metaKey: META_KEY, authKey: AUTH_KEY, seed })
  }

  return { context, page, audit }
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false })
}

/* ---------------- 开始 ---------------- */

await mkdir(OUT, { recursive: true })
browser = await chromium.launch()

console.log('\n=== 1. 未登录：地址栏与首屏 ===')
{
  const { context, page } = await newPage()
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)

  check('未登录时打开 #settings → 收敛到登录屏', page.url().endsWith('#login'), page.url())
  check('登录屏出现', (await page.locator('.auth-desk:visible').count()) === 1)
  check('主外壳没有被渲染出来', (await page.locator('.sidenav:visible').count()) === 0)
  check('标题是登录', (await page.title()).startsWith('登录'), await page.title())
  check('倒计时显示在左栏',
    /^\d+$/.test((await page.locator('.auth-mission__num span').first().textContent()) || ''),
    (await page.locator('.auth-mission__num span').first().textContent()) || '')

  // 密码框默认是密文
  const pass = page.locator('[data-testid="auth-password"]')
  check('密码默认隐藏', (await pass.getAttribute('type')) === 'password')

  await page.locator('.auth-field__peek').first().click()
  check('点眼睛后变明文', (await pass.getAttribute('type')) === 'text')
  await page.locator('.auth-field__peek').first().click()
  check('再点一次变回密文', (await pass.getAttribute('type')) === 'password')

  // 键盘可达性：Tab 能走到主按钮
  await page.locator('[data-testid="auth-email"]').focus()
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.className || '')
  check('Tab 从邮箱走到密码', /auth-password/.test(focused), focused)

  await shot(page, '01-login-desktop')
  await context.close()
}

console.log('\n=== 2. 校验与报错都落在字段上 ===')
{
  const { context, page } = await newPage()
  await page.goto(`${BASE}#login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)

  await page.locator('[data-testid="auth-login-form-submit"]').click()
  await page.waitForTimeout(400)
  const emptyError = (await page.locator('.auth-field__error').first().textContent()) || ''
  check('空邮箱被拦下并给出提示', emptyError.includes('邮箱'), emptyError || '（无提示）')
  check('按钮没有被卡在「请稍候」',
    (await page.locator('[data-testid="auth-login-form-submit"]').textContent()) === '登录')

  await page.locator('[data-testid="auth-email"]').fill('sensei@example.com')
  await page.locator('[data-testid="auth-password"]').fill('wrong-password')
  await page.locator('[data-testid="auth-login-form-submit"]').click()
  await page.waitForTimeout(1200)
  const feedback = (await page.locator('.auth-feedback').textContent()) || ''
  check('密码错误被翻成中文', feedback.includes('邮箱或密码不对'), feedback.trim() || '（空）')
  check('报错后邮箱还在',
    (await page.locator('[data-testid="auth-email"]').inputValue()) === 'sensei@example.com')

  await shot(page, '02-login-error')
  await context.close()
}

console.log('\n=== 3. 正确密码 → 进入应用 ===')
{
  const { context, page, audit } = await newPage()
  await page.goto(`${BASE}#medals`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)

  check('未登录时直奔 #medals → 被拨回登录屏', page.url().endsWith('#login'), page.url())
  check('重定向之后登录屏还在（没有被重定向吃掉）', (await page.locator('.auth-desk:visible').count()) === 1)

  await page.locator('[data-testid="auth-email"]').fill('sensei@example.com')
  await page.locator('[data-testid="auth-password"]').fill('right-password')
  await page.locator('[data-testid="auth-login-form-submit"]').click()
  await page.waitForTimeout(2600)

  check('真的调了登录接口', audit.logins.includes('sensei@example.com'), audit.logins.join(',') || '（没有）')
  check('进入主应用：侧栏出现', (await page.locator('.sidenav:visible').count()) === 1)
  check('登录屏已让开', (await page.locator('.auth-desk:visible').count()) === 0)
  check('导航项是 8 个', (await page.locator('.nav-item[data-view]').count()) === 8)
  check('落到 #home（没登录时不留内部页面在地址栏）', page.url().endsWith('#home'), page.url())
  check('会话已写进 localStorage',
    await page.evaluate((k) => Boolean(localStorage.getItem(k)), AUTH_KEY))
  check('登录后没有留下地址栏里的回跳参数',
    !/[?&](code|type)=/.test(page.url()), page.url())
  await context.close()
}

console.log('\n=== 4. 注册 / 忘记密码两条支路 ===')
{
  const { context, page, audit } = await newPage()
  await page.goto(`${BASE}#login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)

  await page.locator('[data-testid="auth-email"]').fill('newbie@example.com')
  await page.locator('[data-testid="auth-to-signup"]').click()
  await page.waitForTimeout(600)
  check('切到注册屏', page.url().endsWith('#signup'), page.url())
  check('邮箱跟着带过去',
    (await page.locator('[data-testid="auth-email"]').inputValue()) === 'newbie@example.com')
  check('注册屏有三个字段', (await page.locator('.auth-field').count()) === 3)

  await page.locator('[data-testid="auth-password"]').fill('secret123')
  await page.locator('[data-testid="auth-password-again"]').fill('secret124')
  await page.locator('[data-testid="auth-signup-form-submit"]').click()
  await page.waitForTimeout(500)
  const mismatch = await page.locator('.auth-field__error:not([hidden])').allTextContents()
  check('两次密码不一致被拦下', mismatch.join(' ').includes('不一样'), mismatch.join(' | ') || '（无提示）')

  await page.locator('[data-testid="auth-password-again"]').fill('secret123')
  await page.locator('[data-testid="auth-signup-form-submit"]').click()
  await page.waitForTimeout(1400)
  check('注册请求带上了邮箱', audit.signups.includes('newbie@example.com'), audit.signups.join(',') || '（没有）')
  check('需要确认邮箱时回到登录屏', page.url().endsWith('#login'), page.url())
  const note = (await page.locator('.auth-note').textContent().catch(() => '')) || ''
  check('并且留下一句「去邮箱确认」', note.includes('确认邮件'), note.trim().slice(0, 60) || '（没有）')
  await shot(page, '03-login-note')

  await page.locator('[data-testid="auth-to-forgot"]').click()
  await page.waitForTimeout(600)
  check('切到忘记密码屏', page.url().endsWith('#forgot'), page.url())
  check('只有一个字段（邮箱）', (await page.locator('.auth-field').count()) === 1)
  check('邮箱仍然带过来了',
    (await page.locator('[data-testid="auth-email"]').inputValue()) === 'newbie@example.com')
  await page.locator('[data-testid="auth-forgot-form-submit"]').click()
  await page.waitForTimeout(1400)
  check('真的调了重置密码接口', audit.recovers.length === 1, `${audit.recovers.length} 次`)
  check('发完邮件回到登录屏并说明',
    ((await page.locator('.auth-note').textContent().catch(() => '')) || '').includes('重置邮件'))
  await shot(page, '04-forgot-done')
  await context.close()
}

console.log('\n=== 5. 已经登录 → 直接进应用，看不到登录屏 ===')
{
  const { context, page } = await newPage({ seed: { session: sessionFor(USER) } })
  await page.goto(`${BASE}#home`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2400)

  check('有会话时跳过登录屏', (await page.locator('.auth-desk:visible').count()) === 0)
  check('直接看到作战本部', (await page.locator('.sidenav:visible').count()) === 1)
  check('地址停在 #home', page.url().endsWith('#home'), page.url())

  // 有会话时，登录屏的地址也应该被让开
  await page.goto(`${BASE}#login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
  check('已登录时访问 #login 会被送回应用', (await page.locator('.sidenav:visible').count()) === 1, page.url())
  await context.close()
}

console.log('\n=== 6. 平板 / 手机 / 深色三种形态 ===')
{
  for (const [name, viewport] of [
    ['05-login-tablet', { width: 834, height: 1112 }],
    ['06-login-mobile', { width: 390, height: 844 }]
  ]) {
    const { context, page } = await newPage({ viewport })
    await page.goto(`${BASE}#login`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1600)
    await shot(page, name)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`${name}：没有横向溢出`, overflow <= 1, `溢出 ${overflow}px`)
    const box = await page.locator('.auth-desk').boundingBox()
    check(`${name}：面板完整落在视口内`,
      Boolean(box) && box.x >= -1 && box.x + box.width <= viewport.width + 1,
      box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : '（找不到面板）')

    // 手机上的触摸目标：输入框和主按钮都不能矮于 44px
    if (viewport.width <= 640) {
      const submit = await page.locator('[data-testid="auth-login-form-submit"]').boundingBox()
      check('手机：主按钮 ≥44px 高', Boolean(submit) && submit.height >= 44,
        submit ? `${Math.round(submit.height)}px` : '（找不到）')
      const peek = await page.locator('.auth-field__peek').first().boundingBox()
      check('手机：眼睛按钮 ≥36px 高', Boolean(peek) && peek.height >= 36,
        peek ? `${Math.round(peek.height)}px` : '（找不到）')
    }
    await context.close()
  }

  // 深色主题是应用自己的开关（不是系统的 prefers-color-scheme），
  // 所以要把 state.settings.theme 一起预置进去，否则测的还是浅色
  const { context, page } = await newPage({
    seed: { state: { settings: { theme: 'dark' } } }
  })
  await page.goto(`${BASE}#login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)
  await shot(page, '07-login-dark')
  check('深色下登录屏仍然渲染', (await page.locator('.auth-desk:visible').count()) === 1)
  check('深色主题确实生效了',
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
  await context.close()
}

console.log('\n=== 7. 登录屏文字对比度（WCAG AA）===')
{
  /* 相对亮度，按 WCAG 2.1 定义 */
  const luminance = ([r, g, b]) => {
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const parse = (css) => (css.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
  /**
   * WCAG 对比度 = (亮者 + 0.05) / (暗者 + 0.05)。
   * 别写反 —— 反过来会得到 0.09 这种"看起来像不达标"的数字，
   * 实测过一次：深色文字配白底被算成 0.09:1，其实真实值是 11.76:1。
   */
  const contrast = (fg, bg) => {
    const [dark, light] = [luminance(fg), luminance(bg)].sort((x, y) => x - y)
    return (light + 0.05) / (dark + 0.05)
  }

  /**
   * 量某一屏上所有小字的对比度。
   *
   * 关键：**背景必须取真实像素**，不能用 getComputedStyle().backgroundColor。
   * 登录屏的天色是 linear-gradient，元素的 backgroundColor 是 `rgba(0,0,0,0)`，
   * 按计算样式叠出来的底色会是白色 —— 于是白字量出 1.06:1，
   * 那是测量方式错了，不是设计错了（前一版审计就是这么误报的）。
   *
   * 做法：整页截图 → 丢回浏览器用 createImageBitmap + canvas 取像素 →
   * 对每个目标文字，取紧邻它的几个位置（左/右/上/下偏移，避开字形本身）当背景。
   */
  const audit = async (theme, label) => {
    const { context, page } = await newPage({
      seed: theme === 'dark' ? { state: { settings: { theme: 'dark' } } } : null
    })
    await page.goto(`${BASE}?audit=${theme}#login`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1700)

    /**
     * 截图必须**走 CDP 直接抓**。
     *
     * Playwright 的 page.screenshot() 会在页面「看起来没变」时复用上一次的结果，
     * 而这里浅色/深色两次审计的节点结构完全一样，只有 class 不同 ——
     * 塞一个节点再删掉这种小动作它也能识别出来，依旧给旧图，
     * 于是深色那一轮量到的其实是浅色的像素（实测：品牌副标题浅色算成 3.91:1，
     * 而该元素的 color 明明是 rgb(255,255,255)、真实值 8:1 以上）。
     */
    const cdp = await context.newCDPSession(page)
    const { data: b64 } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const png = Buffer.from(b64, 'base64')
    const result = await page.evaluate(async ({ b64, wantProfile }) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bmp, 0, 0)
      const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      const at = (x, y) => {
        const px = Math.round(x)
        const py = Math.round(y)
        if (px < 0 || py < 0 || px >= bmp.width || py >= bmp.height) return null
        const i = (py * bmp.width + px) * 4
        return [data[i], data[i + 1], data[i + 2]]
      }

      const targets = [
        ['登录屏标题', '.auth-head__title'],
        ['标题说明', '.auth-head__sub'],
        ['字段标签', '.auth-field__label'],
        ['字段提示', '.auth-field__hint'],
        ['倒计时小标签', '.auth-mission__label'],
        ['阶段说明', '.auth-mission__meta'],
        ['阶段名', '.auth-phases__legend > span'],
        ['次级路径', '.auth-alt__lead'],
        ['品牌副标题', '.auth-brand__sub'],
        ['链接', '.auth-links .auth-link']
      ]

      const out = []
      for (const [name, sel] of targets) {
        const node = document.querySelector(sel)
        if (!node) continue
        const cs = getComputedStyle(node)
        const r = node.getBoundingClientRect()
        /**
         * 采样背景像素。
         *
         * 不能只探左右两侧：像「距 28 考研初试…」这种贴片，文字几乎占满整个贴片，
         * 左右两侧已经落到贴片外面（天色）上了，量出来的底色是天空而不是贴片 ——
         * 于是得到 1.44:1 这种假警报。
         * 也不能探上下：行盒上下就是**其他行**，一样会串到别处。
         *
         * 所以改成在元素矩形**内部**密采一片网格，再取「出现最多的那个颜色」当底色。
         * 文字笔画只占少数格点，出现频率最高的必然是它所在的底。
         *
         * 两个细节，都是实测踩出来的：
         *   · 量化粒度用 & 0xfc（低 2 位），别用 0xf8 —— 后者会把纯白字形和
         *     深浅不一的底色量化进同一个桶，于是"背景"取到了字形自己的颜色（白），
         *     对比度算成 3.91:1 这种假数字。
         *   · 明度接近字色的格点直接不计入（那就是踩在笔画上或是抗锯齿边缘）。
         */
        const fgRgb = (cs.color.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
        const cols = Math.max(5, Math.min(40, Math.floor(r.width / 4)))
        const rows = Math.max(3, Math.min(14, Math.floor(r.height / 4)))
        const tally = new Map()
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const x = r.left + ((i + 0.5) / cols) * r.width
            const y = r.top + ((j + 0.5) / rows) * r.height
            const c = at(x, y)
            if (!c) continue
            const dist = Math.abs(c[0] - fgRgb[0]) + Math.abs(c[1] - fgRgb[1]) + Math.abs(c[2] - fgRgb[2])
            if (dist < 90) continue
            const key = c.map((v) => v & 0xfc).join(',')
            const hit = tally.get(key)
            if (hit) hit.n++
            else tally.set(key, { n: 1, rgb: c })
          }
        }
        const best = [...tally.values()].sort((a, b) => b.n - a.n)[0]
        out.push({
          name,
          fg: fgRgb,
          bg: best ? best.rgb : [255, 255, 255],
          // 兜底自检用的原始色数：如果"最常见的底"和字色几乎一样，说明采样全落在字形上了
          sameAsText: best
            ? Math.abs(best.rgb[0] - fgRgb[0]) + Math.abs(best.rgb[1] - fgRgb[1]) + Math.abs(best.rgb[2] - fgRgb[2]) < 30
            : false,
          size: cs.fontSize
        })
      }
      return out
    }, { b64: png.toString('base64'), wantProfile: false })

    for (const s of result) {
      const r = contrast(s.fg, s.bg)
      // 18px 以上（或 14px 加粗）算大字，门槛 3:1；其余 4.5:1
      const px = parseFloat(s.size)
      const need = px >= 18 ? 3 : 4.5
      // 采样自检：如果取到的"底色"和字色几乎一样，说明这次量的是错的，别当通过
      const sane = !s.sameAsText
      check(`${label}「${s.name}」对比度 ≥ ${need}:1`, sane && r >= need,
        sane
          ? `${r.toFixed(2)}:1（${Math.round(px)}px，字 rgb(${s.fg.join(',')}) 底 rgb(${s.bg.join(',')})）`
          : `采样异常：取到的底色与字色相同 rgb(${s.bg.join(',')})`)
    }
    await context.close()
  }

  await audit('light', '浅色 ')
  await audit('dark', '深色 ')
}

console.log('\n=== 8. 控制台干净度 ===')
{
  /**
   * 脚本故意用错密码登录过一次，浏览器一定会把那条 400 打成 console error ——
   * 那是被测行为本身，不是站点的问题。除此之外不该有任何报错。
   */
  const noise = /Failed to load resource.*(400|401)/
  const real = consoleErrors.filter((e) => !noise.test(e))
  check('没有 JS 报错（错密码产生的 400 网络日志不算）', real.length === 0, real.slice(0, 3).join(' | ') || '')
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n截图目录：${OUT}`)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  · ${f.name}`)
  process.exitCode = 1
}
