/**
 * 登录场景验收。开发服务器须使用假 Supabase 配置：
 *   $env:VITE_SUPABASE_URL='https://fake-project.supabase.co'
 *   $env:VITE_SUPABASE_ANON_KEY='fake-anon-key-for-local-verification-only'
 *   npm run dev -- --port 4330 --strictPort
 *   node scripts/verify-shittim-login.mjs
 *
 * 所有 *.supabase.co / *.supabase.in 请求均由本脚本模拟，不使用真实账号。
 * 输出报告与截图默认保存在系统临时目录，可用 SMOKE_OUT 覆盖。
 * 通过 DOM 状态、请求闸门和绘制次数等待；不以固定延时猜测进入时机。
 * 像素检查只能排除空白/冻结，原版素材完整性需结合截图人工核验。
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4330/'
const OUT = process.env.SMOKE_OUT || join(tmpdir(), 'kaoyan-shittim-login')
const AUTH_KEY = 'kivotos-kaoyan-auth'
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'scene-test@example.com' }
const results = []
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function session() {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 86400 })
  const signature = createHmac('sha256', 'local-test-only-secret-at-least-32-characters').update(`${head}.${body}`).digest('base64url')
  return {
    access_token: `${head}.${body}.${signature}`, token_type: 'bearer',
    expires_in: 86400, expires_at: now + 86400, refresh_token: `fake-${USER.id}`,
    user: { ...USER, aud: 'authenticated', role: 'authenticated', email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString() }
  }
}
const json = (route, status, value) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
const selector = (id) => `[data-testid="${id}"]`
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
await mkdir(OUT, { recursive: true })

async function newPage({ reduced = false, noWebGL = false, noSceneModule = false, brokenAssets = false, holdAssets = false, seeded = false, hour = 12, viewport = { width: 1440, height: 960 } } = {}) {
  const context = await browser.newContext({ viewport, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const localTime = new Date()
  localTime.setUTCHours(hour - 8, 0, 0, 0)
  await page.clock.setFixedTime(localTime)
  const audit = { logins: [], errors: [], holdLogin: false, releaseLogin: null, assets: [], activeAssets: new Set(), releaseAssets: null }
  let releaseAssets
  const assetsGate = new Promise((resolve) => { releaseAssets = resolve })
  audit.releaseAssets = releaseAssets
  page.on('pageerror', (error) => audit.errors.push(error.message))
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/shittim/')) audit.activeAssets.add(request)
  })
  page.on('requestfinished', (request) => audit.activeAssets.delete(request))
  page.on('requestfailed', (request) => audit.activeAssets.delete(request))
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (noSceneModule &&
        (url.pathname === '/src/lib/scene-stage.js' || /\/assets\/scene-stage-[^/]+\.js$/.test(url.pathname))) {
      return route.abort('failed')
    }
    if (/\.supabase\.(?:co|in)$/i.test(url.hostname)) {
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const body = JSON.parse(request.postData() || '{}')
        audit.logins.push({ email: body.email, at: Date.now() })
        if (audit.holdLogin) await new Promise((resolve) => { audit.releaseLogin = resolve })
        return body.password === 'right-password'
          ? json(route, 200, session())
          : json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
      }
      if (url.pathname === '/auth/v1/token') return json(route, 200, session())
      if (url.pathname === '/auth/v1/user') return json(route, 200, session().user)
      if (url.pathname === '/auth/v1/settings') return json(route, 200, { mailer_autoconfirm: true, external: { email: true } })
      if (url.pathname.startsWith('/rest/v1/')) return json(route, request.method() === 'GET' ? 200 : 201, null)
      return json(route, 200, {})
    }
    if (url.pathname.includes('/shittim/')) {
      audit.assets.push(url.pathname)
      if (holdAssets) await assetsGate
      if (brokenAssets) return route.abort('failed')
    }
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    if (url.hostname === 'fonts.gstatic.com') return route.abort()
    // 本地验收不允许未知第三方请求带走表单内容。
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient')
    return route.continue()
  })
  await page.addInitScript(({ noWebGL, seeded, seedSession, authKey }) => {
    if (seeded) localStorage.setItem(authKey, JSON.stringify(seedSession))
    localStorage.setItem('kivotos-kaoyan-v1', JSON.stringify({ onboarded: true }))
    const probe = window.__loginAudit = { entries: [], stages: [], glCreated: 0, glLost: 0, drawCalls: 0, lateWrites: 0, contexts: [] }
    const seenEntries = new WeakSet()
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target === document.documentElement && record.attributeName === 'data-stage') {
          probe.stages.push({ value: record.target.dataset.stage, at: performance.now(), entries: probe.entries.length })
        }
        for (const node of record.addedNodes || []) {
          if (!(node instanceof Element)) continue
          const entries = [...node.querySelectorAll('[data-testid="login-entry"]')]
          if (node.matches('[data-testid="login-entry"]')) entries.push(node)
          for (const entry of entries) if (!seenEntries.has(entry)) {
            seenEntries.add(entry)
            probe.entries.push({ at: performance.now(), stage: document.documentElement.dataset.stage })
          }
        }
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-stage'] })
    const original = HTMLCanvasElement.prototype.getContext
    const seen = new WeakSet()
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (noWebGL && /webgl/i.test(type)) return null
      const gl = original.call(this, type, ...args)
      if (!gl || !/webgl/i.test(type) || seen.has(gl)) return gl
      seen.add(gl)
      probe.glCreated++
      const item = { lost: false, draws: 0 }
      probe.contexts.push(item)
      const markLost = () => { if (!item.lost) { item.lost = true; probe.glLost++ } }
      this.addEventListener('webglcontextlost', markLost)
      const getExtension = gl.getExtension.bind(gl)
      gl.getExtension = (name) => {
        const extension = getExtension(name)
        if (name === 'WEBGL_lose_context' && extension && !extension.__wrappedForTest) {
          const lose = extension.loseContext.bind(extension)
          extension.loseContext = () => { markLost(); return lose() }
          extension.__wrappedForTest = true
        }
        return extension
      }
      for (const name of ['drawArrays', 'drawElements']) {
        const draw = gl[name].bind(gl)
        gl[name] = (...params) => { probe.drawCalls++; item.draws++; if (item.lost) probe.lateWrites++; return draw(...params) }
      }
      const upload = gl.texImage2D.bind(gl)
      gl.texImage2D = (...params) => { if (item.lost) probe.lateWrites++; return upload(...params) }
      return gl
    }
  }, { noWebGL, seeded, seedSession: session(), authKey: AUTH_KEY })
  return { context, page, audit }
}

async function openLogin(page) {
  await page.goto(`${BASE}#login`, { waitUntil: 'domcontentloaded' })
  await page.locator(selector('auth-email')).waitFor({ state: 'visible' })
}
async function sceneSettled(page) {
  await page.waitForFunction(() => ['ready', 'fallback'].includes(document.querySelector('.login-scene')?.dataset.state), null, { timeout: 60000 })
  return page.locator('.login-scene').getAttribute('data-state')
}
async function credentials(page, password = 'right-password') {
  await page.locator(selector('auth-email')).fill(USER.email)
  await page.locator(selector('auth-password')).fill(password)
}
async function waitAudit(predicate, message) {
  const deadline = Date.now() + 15000
  while (!predicate()) {
    assert(Date.now() < deadline, message)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
async function submit(page) { await page.locator(selector('auth-login-form-submit')).click() }
async function enteredApp(page) {
  await page.locator('html[data-stage="app"]').waitFor({ state: 'attached', timeout: 30000 })
  await page.locator('.sidenav').waitFor({ state: 'visible' })
}
async function shot(page, name) { await page.screenshot({ path: join(OUT, `${name}.png`) }) }
async function probe(page) { return page.evaluate(() => window.__loginAudit) }
async function run(name, callback) {
  if (process.env.SMOKE_CASE && !new RegExp(process.env.SMOKE_CASE).test(name)) return
  console.log(`\n${name}`)
  try { await callback(); results.push({ name, ok: true }); console.log('  通过') }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error(`  失败：${error.message}`) }
}
async function withPage(options, callback) {
  const fixture = await newPage(options)
  try { await callback(fixture); assert.deepEqual(fixture.audit.errors, [], '不能出现未捕获 JS 错误') }
  catch (error) { await shot(fixture.page, `failure-${results.length + 1}`).catch(() => {}); throw error }
  finally { fixture.audit.releaseLogin?.(); fixture.audit.releaseAssets(); await fixture.context.close() }
}

try {
  await run('日景常驻、画布非空且真实帧持续更新', () => withPage({ hour: 12 }, async ({ page }) => {
    await openLogin(page)
    assert.equal(await sceneSettled(page), 'ready')
    const canvas = page.locator(selector('login-scene-canvas'))
    await canvas.waitFor({ state: 'visible' })
    const first = await canvas.screenshot()
    const before = await probe(page)
    assert(before.glCreated > 0 && before.drawCalls > 0, '必须实际调用 WebGL 绘制')
    await page.waitForFunction((count) => window.__loginAudit.drawCalls >= count + 50, before.drawCalls)
    const second = await canvas.screenshot()
    assert(!first.equals(second), '待机场景应有真实像素变化')
    const pixels = await page.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      const colors = new Set()
      for (let i = 0; i < data.length; i += 4 * 31) colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`)
      return colors.size
    }, second.toString('base64'))
    assert(pixels > 40, `画面色彩不足，可能是空白/单色背景：${pixels}`)
    assert.equal((await probe(page)).entries.length, 0, '未认证不能播放进入动画')
    await shot(page, '01-day-desktop')
    const poke = page.locator(selector('scene-poke'))
    await poke.click()
    assert.equal((await probe(page)).entries.length, 0, '互动不能触发进入流程')
    await shot(page, '02-day-poke')
  }))

  await run('夜景与手机布局', () => withPage({ hour: 23, viewport: { width: 390, height: 844 } }, async ({ page, audit }) => {
    await openLogin(page)
    assert.equal(await sceneSettled(page), 'ready')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    assert(overflow <= 1, `手机横向溢出 ${overflow}px`)
    const form = await page.locator('.auth-desk').boundingBox()
    assert(form && form.x >= -1 && form.x + form.width <= 391, '登录面板应完整处于横向视口')
    assert(audit.assets.some((path) => /night/i.test(path)), '夜间必须请求夜间房间素材')
    await shot(page, '03-night-mobile')
  }))

  await run('错密码不播；认证成功后单次动画；连续提交仅一个请求；退登再登录重播', () => withPage({}, async ({ page, audit }) => {
    await openLogin(page)
    await sceneSettled(page)
    await credentials(page, 'wrong-password')
    await submit(page)
    await page.locator('.auth-feedback:not([hidden])').waitFor({ state: 'visible' })
    assert.equal((await probe(page)).entries.length, 0)
    assert.equal(await page.locator('html').getAttribute('data-stage'), 'auth')
    await shot(page, '04-wrong-password')

    audit.holdLogin = true
    await credentials(page)
    await page.locator(selector('auth-login-form')).evaluate((form) => {
      for (let i = 0; i < 5; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await waitAudit(() => Boolean(audit.releaseLogin), '正确密码请求未到达假后端')
    assert.equal(audit.logins.length, 2, '一次错误请求 + 一次正确请求')
    assert.equal((await probe(page)).entries.length, 0, '后端尚未确认，不能先播')
    assert.equal(await page.locator('html').getAttribute('data-stage'), 'auth')
    audit.holdLogin = false
    audit.releaseLogin()
    await page.locator('.auth[data-entering="true"]').waitFor({ state: 'visible' })
    await page.locator(selector('login-entry')).waitFor({ state: 'visible' })
    assert.equal(await page.locator('html').getAttribute('data-stage'), 'auth', '动画结束前应保持登录阶段')
    await shot(page, '05-entry-before-app')
    await page.waitForFunction(() => document.querySelector('[data-testid="login-entry"]')?.getAnimations().some((animation) => animation.currentTime >= 700))
    assert.equal(await page.locator('html').getAttribute('data-stage'), 'auth')
    await shot(page, '05-entry-splash-visible')
    await enteredApp(page)
    const first = await probe(page)
    assert.equal(first.entries.length, 1)
    assert(first.stages.some((stage) => stage.value === 'app' && stage.entries === 1), '先进入动画，后进入 app')
    assert.equal(first.glCreated - first.glLost, 0, '登录场景离开后应释放 WebGL')

    // 使用应用内真实退登入口，而不是直接清 localStorage。
    await page.evaluate(() => { location.hash = 'settings' })
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await page.locator(selector('auth-email')).waitFor({ state: 'visible' })
    await sceneSettled(page)
    await credentials(page)
    await submit(page)
    await enteredApp(page)
    const second = await probe(page)
    assert.equal(second.entries.length, 2, '退出后再次主动登录必须再次播放')
    assert.equal(second.glCreated - second.glLost, 0, '第二次登录后也应释放 WebGL')
    assert.equal(audit.logins.length, 3)
    await shot(page, '06-relogin-app')
  }))

  await run('已有会话刷新直接进入，不创建登录动画和场景上下文', () => withPage({ seeded: true }, async ({ page }) => {
    await page.goto(`${BASE}#home`, { waitUntil: 'domcontentloaded' })
    await enteredApp(page)
    let state = await probe(page)
    assert.equal(state.entries.length, 0)
    assert.equal(state.glCreated, 0)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await enteredApp(page)
    state = await probe(page)
    assert.equal(state.entries.length, 0)
    assert.equal(state.glCreated, 0)
  }))

  await run('登录/注册/忘记密码切换释放旧场景，最多保留一个上下文', () => withPage({}, async ({ page }) => {
    await openLogin(page)
    await sceneSettled(page)
    for (let i = 0; i < 2; i++) {
      for (const [link, mode] of [['auth-to-signup', 'signup'], ['auth-to-login', 'login'], ['auth-to-forgot', 'forgot'], ['auth-to-login', 'login']]) {
        await page.locator(selector(link)).click()
        await page.locator(`.auth[data-mode="${mode}"]`).waitFor({ state: 'visible' })
        await sceneSettled(page)
        const state = await probe(page)
        assert(state.glCreated - state.glLost <= 1, `${mode} 仍保留 ${state.glCreated - state.glLost} 个上下文`)
      }
    }
    assert.equal((await probe(page)).entries.length, 0)
  }))

  await run('路由切走后旧认证请求不能覆盖新表单', () => withPage({}, async ({ page, audit }) => {
    await openLogin(page)
    await sceneSettled(page)
    audit.holdLogin = true
    await credentials(page)
    await submit(page)
    await waitAudit(() => Boolean(audit.releaseLogin), '认证请求未发出')
    await page.locator(selector('auth-to-signup')).click()
    await page.locator('.auth[data-mode="signup"]').waitFor({ state: 'visible' })
    const response = page.waitForResponse((response) => response.url().includes('/auth/v1/token'))
    audit.releaseLogin()
    await response
    await sceneSettled(page)
    assert.equal(await page.locator('html').getAttribute('data-stage'), 'auth')
    assert.equal(await page.locator('.auth').getAttribute('data-mode'), 'signup')
    assert.equal((await probe(page)).entries.length, 0)
  }))

  for (const [name, options] of [['WebGL 不可用', { noWebGL: true }], ['素材请求失败', { brokenAssets: true }]]) {
    await run(`${name}仍可登录`, () => withPage(options, async ({ page }) => {
      await openLogin(page)
      assert.equal(await sceneSettled(page), 'fallback')
      await shot(page, options.noWebGL ? '07-no-webgl' : '08-assets-failed')
      await credentials(page)
      await submit(page)
      await enteredApp(page)
      assert.equal((await probe(page)).glCreated - (await probe(page)).glLost, 0)
    }))
  }

  await run('场景模块加载失败仍显示同幕静态图并允许登录', () => withPage({ noSceneModule: true, hour: 13 }, async ({ page }) => {
    await openLogin(page)
    assert.equal(await sceneSettled(page), 'fallback')
    const scene = page.locator('.login-scene')
    assert.equal(await scene.getAttribute('data-scene'), 'day_2')
    const poster = page.locator('.login-scene__poster')
    assert.equal(await poster.evaluate((image) => image.complete && image.naturalWidth > 0), true)
    await credentials(page)
    await submit(page)
    await enteredApp(page)
  }))

  await run('素材仍在加载时认证成功也有有界兜底', () => withPage({ holdAssets: true }, async ({ page, audit }) => {
    await openLogin(page)
    await page.locator('.login-scene[data-state="loading"]').waitFor({ state: 'visible' })
    await credentials(page)
    await submit(page)
    await enteredApp(page)
    audit.releaseAssets()
    await waitAudit(() => audit.activeAssets.size === 0, '释放闸门后素材请求没有完成')
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const state = await probe(page)
    assert.equal(state.glCreated - state.glLost, 0)
    assert.equal(state.lateWrites, 0, '晚到素材不得在已释放上下文上传纹理或继续绘制')
  }))

  await run('减少动态效果使用静态场景和短进入过渡', () => withPage({ reduced: true }, async ({ page }) => {
    await openLogin(page)
    await sceneSettled(page)
    await shot(page, '09-reduced-motion')
    const before = await probe(page)
    // 两个浏览器绘制帧间不应继续渲染 Spine 待机；requestAnimationFrame 是观测窗口。
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal((await probe(page)).drawCalls, before.drawCalls, 'reduced-motion 场景必须静止')
    await credentials(page)
    await submit(page)
    await enteredApp(page)
    const state = await probe(page)
    const app = state.stages.find((stage) => stage.value === 'app')
    assert(app && state.entries.length === 1, '仍保留一次轻量进入反馈')
    assert(app.at - state.entries[0].at < 1500, '减少动态效果不应等待长片头')
    assert.equal(state.glCreated - state.glLost, 0)
  }))
} finally {
  await browser.close()
  await writeFile(join(OUT, 'report.json'), JSON.stringify({ base: BASE, createdAt: new Date().toISOString(), results }, null, 2))
}
const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} 组通过。截图与报告：${OUT}`)
if (failed.length) process.exitCode = 1
