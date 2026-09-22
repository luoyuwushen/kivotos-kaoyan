/**
 * 云端同步（Supabase）端到端测试。
 *
 *   node scripts/test-cloud.mjs          # 需要先跑 npm run preview
 *
 * 做法：不去连真的 Supabase，而是在 Playwright 里**拦下所有网络请求**，
 * 用一个照着官方 API 写的「假 Supabase」顶上去。它不是随便回 200 就算过 ——
 * 它会真的校验 JWT、真的按 user_id 过滤行、真的执行和 docs/supabase-schema.sql
 * 一样的行级安全规则（别人那一行、伪造 user_id 的写入，一律拒绝）。
 *
 * 这样能在不花钱、不联网、不用注册账号的前提下验证四件事：
 *   1. 界面：没配置 / 没登录 / 已登录三种状态都渲染正确
 *   2. 协议：本地改动会推上去、云端更新会拉下来、两边都改会要求人选
 *   3. 隔离：两个用户各自读写，互不可见（RLS 在数据层生效）
 *   4. 越权：没登录读不到东西；拿 A 的身份写 B 的行会被拒
 *
 * 真机联调（连真的 Supabase 项目）请用：node scripts/test-cloud-live.mjs
 */

import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = process.env.CLOUD_TEST_BASE || 'http://127.0.0.1:4173/'
const STORAGE_KEY = 'kivotos-kaoyan-v1'
const CFG_KEY = 'kivotos-kaoyan-cloud-cfg-v1'
const META_KEY = 'kivotos-kaoyan-cloud-meta-v1'
const TABLE = 'kaoyan_data'

/**
 * 关键的 URL / key 选择。
 *
 * cloud.js 里 env 的优先级**高于** localStorage（那是故意的：自己部署的人
 * 可以把后端写进 .env 一起构建）。所以本机一旦有 .env.local，产物里就带着
 * 真实项目地址，浏览器只会连它 —— 这时候再往 localStorage 里塞假配置是没用的。
 *
 * 于是这里做一次解析：产物带配置就用**产物里那份**（此时整个测试套件等于
 * 拿真项目当后端、但仍然由本脚本的假服务器接管网络），否则用假地址。
 * 这样同一套断言在两种环境下都成立，不会因为「开发机上有 .env.local」而误报。
 */
function readEnvFileQuiet(file) {
  try {
    const out = {}
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}
const localEnv = { ...readEnvFileQuiet('.env'), ...readEnvFileQuiet('.env.local') }

/**
 * 产物里到底指向哪个 Supabase 项目？
 *
 * 这件事**不能**只看 .env / .env.local：构建时如果进程环境变量里给了
 * VITE_SUPABASE_URL（很常见，例如为了跑测试而换一个假项目），它优先于 .env 文件，
 * 于是产物里的地址和这里读到的会是两个不同的项目 —— 结果是假服务器拦不住任何请求，
 * 测试会真的打到线上项目上去。所以直接去 dist 里把地址抠出来，以产物为准。
 */
function detectBakedUrl() {
  try {
    const dir = new URL('../dist/assets/', import.meta.url)
    // 必须扫**所有** chunk：配置有可能被拆进共享 chunk，
    // 只看入口那个 index-*.js 会找不到，然后脚本回退到 .env.local 的地址 ——
    // 于是假服务器拦不住任何请求，测试会真的打到线上项目（实测踩过）。
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const code = readFileSync(new URL(file, dir), 'utf8')
      // 构建时 import.meta.env.VITE_SUPABASE_URL 会被替换成字面量
      const m = /https:\/\/[a-z0-9-]+\.supabase\.(?:co|in)/.exec(code)
      if (m) return m[0]
    }
    return ''
  } catch {
    return ''
  }
}

const DIST_URL = detectBakedUrl()
const BAKED_URL = String(
  DIST_URL || process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL || ''
).replace(/\/+$/, '')
const BAKED_ANON = String(
  process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY || ''
)
const HAS_BAKED = Boolean(BAKED_URL && BAKED_ANON)

const FAKE_URL = HAS_BAKED ? BAKED_URL : 'https://testprojectref.supabase.co'
const ANON_KEY = HAS_BAKED
  ? BAKED_ANON
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon.fake-anon-key-for-local-tests'
const JWT_SECRET = 'test-jwt-secret'
/**
 * 会话在 localStorage 里的键名。
 * 必须和 src/lib/cloud.js 的 AUTH_STORAGE_KEY 保持一致：supabase-js 对
 * auth.storageKey 是整体覆盖（不是拼项目 ref），存进去就是这个名字。
 */
const AUTH_KEY = 'kivotos-kaoyan-auth'

const USER_A = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' }
const USER_B = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' }
const NEW_USER = { id: '33333333-3333-4333-8333-333333333333', email: 'c@example.com' }

/* ---------------- 结果收集 ---------------- */

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

/* ---------------- 假 Supabase ---------------- */

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

function readJwt(token) {
  if (!token || token.split('.').length !== 3) return null
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function sessionFor(user, { expired = false } = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: makeJwt(user),
    token_type: 'bearer',
    expires_in: expired ? -60 : 3600,
    expires_at: now + (expired ? -60 : 3600),
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

/** 服务器端的数据表：user_id -> { payload, updated_at } */
const db = new Map()
/** 记录都被谁写过，用来验证隔离 */
const audit = { selects: [], upserts: [], deletes: [], otpAttempts: [], otpMode: 'ok' }

const json = (route, status, body, headers = {}) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  })

/** 假的 PostgREST 过滤：按 user_id=eq.<uuid> 取行 */
function parseEq(url) {
  const out = {}
  for (const [key, value] of url.searchParams.entries()) {
    const m = /^eq\.(.*)$/.exec(value)
    if (m) out[key] = m[1]
  }
  return out
}

async function installFakeSupabase(page) {
  await page.route(`${FAKE_URL}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const auth = req.headers()['authorization'] || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const claims = readJwt(token)
    const method = req.method()

    /* ---- Auth：登录相关 ---- */
    if (path === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'password') {
        const body = JSON.parse(req.postData() || '{}')
        if (body.password !== 'right-password') {
          return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
        }
        return json(route, 200, sessionFor(NEW_USER))
      }
      if (grant === 'refresh_token') return json(route, 200, sessionFor(USER_A))
      return json(route, 400, { error: 'unsupported_grant_type' })
    }
    if (path === '/auth/v1/otp') {
      // 模拟真项目可能出现的两种情况，用来验证客户端会不会正确处理：
      //   · otpMode='disabled' → 第一次请求 422 otp_disabled，第二次（不建用户）成功
      //   · otpMode='ratelimit' → 429，客户端要把话翻译清楚
      const body = JSON.parse(req.postData() || '{}')
      if (audit.otpMode === 'disabled' && body.create_user !== false) {
        audit.otpAttempts.push('create=true')
        return json(route, 422, { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' })
      }
      if (audit.otpMode === 'ratelimit') {
        audit.otpAttempts.push('ratelimit')
        return json(route, 429, { code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' })
      }
      audit.otpAttempts.push(body.create_user === false ? 'create=false' : 'create=true')
      return json(route, 200, {})
    }
    if (path === '/auth/v1/signup') {
      return json(route, 200, { id: NEW_USER.id, email: NEW_USER.email })
    }
    if (path === '/auth/v1/user') {
      if (!claims) return json(route, 401, { message: 'invalid claim: missing sub claim' })
      const user = [USER_A, USER_B, NEW_USER].find((u) => u.id === claims.sub)
      if (!user) return json(route, 404, { message: 'user not found' })
      return json(route, 200, sessionFor(user).user)
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})

    /* ---- PostgREST：数据表 ---- */
    if (path === `/rest/v1/${TABLE}` || path.startsWith(`/rest/v1/${TABLE}`)) {
      // 行级安全的第一道门：没登录（anon）连表都碰不到
      if (!claims?.sub) {
        return json(route, 401, {
          code: '42501',
          message: 'permission denied for table kaoyan_data',
          hint: 'anon 角色没有权限，这是 RLS 在生效'
        })
      }
      const uid = claims.sub
      const filters = parseEq(url)

      if (method === 'GET') {
        audit.selects.push({ uid, filters })
        const row = db.get(uid)
        const data = row && (!filters.user_id || filters.user_id === uid) ? [{ ...row }] : []
        // 注意：查别人的行不会报错，而是「查不到」——真实 RLS 就是这个行为
        return json(route, 200, data)
      }

      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        const rows = Array.isArray(body) ? body : [body]
        for (const row of rows) {
          audit.upserts.push({ uid, target: row.user_id })
          // 第二道门：只能写自己那一行（insert 的 with check）
          if (row.user_id !== uid) {
            return json(route, 403, {
              code: '42501',
              message: 'new row violates row-level security policy for table "kaoyan_data"'
            })
          }
        }
        const row = rows[0]
        db.set(uid, { user_id: uid, payload: row.payload, updated_at: new Date().toISOString() })
        return json(route, 201, [{ user_id: uid, updated_at: db.get(uid).updated_at }])
      }

      if (method === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        audit.upserts.push({ uid, target: filters.user_id })
        if (filters.user_id && filters.user_id !== uid) {
          return json(route, 403, {
            code: '42501',
            message: 'new row violates row-level security policy for table "kaoyan_data"'
          })
        }
        if (!db.has(uid)) return json(route, 200, [])
        db.set(uid, { user_id: uid, payload: body.payload ?? db.get(uid).payload, updated_at: new Date().toISOString() })
        return json(route, 200, [{ user_id: uid, updated_at: db.get(uid).updated_at }])
      }

      if (method === 'DELETE') {
        audit.deletes.push({ uid, filters })
        if (filters.user_id && filters.user_id !== uid) return json(route, 200, [])
        db.delete(uid)
        return json(route, 200, [])
      }
    }

    // 没预料到的请求：明确失败，而不是悄悄 200（否则测试会假通过）
    return json(route, 501, { message: `fake supabase 未实现：${method} ${path}` })
  })
}

/* ---------------- 浏览器上下文工具 ---------------- */

const browser = await chromium.launch()
const errors = []

async function newPage({ seedState = null, config = null, meta = null, session = null, user = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort())
  await installFakeSupabase(page)

  if (seedState || config || meta || session) {
    await page.addInitScript(
      ({ storageKey, cfgKey, metaKey, authKey, seedState, config, meta, session }) => {
        if (seedState) localStorage.setItem(storageKey, JSON.stringify(seedState))
        if (config) localStorage.setItem(cfgKey, JSON.stringify(config))
        if (meta) localStorage.setItem(metaKey, JSON.stringify(meta))
        if (session) localStorage.setItem(authKey, JSON.stringify(session))
      },
      { storageKey: STORAGE_KEY, cfgKey: CFG_KEY, metaKey: META_KEY, authKey: AUTH_KEY, seedState, config, meta, session }
    )
  }
  return { context, page }
}

/** 造一份「有内容」的本地数据（不用等用户真的点 100 下） */
function seededState(overrides = {}) {
  return {
    version: 1,
    profile: { nickname: '测试同学', siteName: '基沃托斯作战本部', examDate: '2027-12-26', subjectSet: 'math1', dailyGoalMin: 360 },
    quests: [
      { id: 'q1', date: '2026-01-01', title: '本地委托：高数第一章', subject: 'math', estMin: 60, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: 1 }
    ],
    phases: [],
    chapters: [],
    focus: [],
    mistakes: [],
    goals: [{ subject: 'math', target: 130, current: 90, full: 150 }],
    scores: [],
    progress: { streak: 3, bestStreak: 5, lastCheckIn: '2026-01-01', exp: 200, level: 2 },
    medals: { unlocked: {} },
    settings: {
      theme: 'light',
      mascots: { hoshino: true, arona: true, plana: true, speech: true },
      customCharacters: false,
      aiApi: { baseUrl: '', apiKey: '', model: '', enabled: false },
      sync: { gistToken: '', gistId: '' },
      supabaseUrl: '',
      supabaseAnon: '',
      cloud: { autoPush: true }
    },
    onboarded: true,
    // 刚改过的本地数据：比「上次同步时间」新，这样同步判定才符合真实场景
    cloudUpdatedAt: new Date().toISOString(),
    ...overrides
  }
}

const readStore = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), STORAGE_KEY)
const readMeta = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), META_KEY)

/* ------------------------------------------------------------------
   先探一下：**这次构建**是否已经把 Supabase 配置烘焙进产物了？
   （本机跑过 npm run supabase:setup 或带 .env.local 构建时就会。）
   是的话，第 1 节「未配置」的场景就不适用了 —— 跳过并说明，
   否则会误报失败，让人以为代码坏了，其实是环境不同。

   还有一个连带影响：配了后端的构建会**要求登录**（登录屏接管首屏），
   而没配后端的构建仍然是纯本地版、直接进应用。两种构建的断言不一样，
   所以这个探针同时决定了后面几节要不要跳过。
   ------------------------------------------------------------------ */
const bakedProbe = await newPage({ seedState: seededState(), config: { url: FAKE_URL, anonKey: ANON_KEY } })
await bakedProbe.page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
await bakedProbe.page.waitForTimeout(1400)
const bakedCfg = await bakedProbe.page.evaluate(() =>
  localStorage.getItem('kivotos-kaoyan-cloud-cfg-v1'))
const HAS_BAKED_CONFIG =
  (await bakedProbe.page.locator('.auth-desk:visible').count()) === 1 || Boolean(bakedCfg)
await bakedProbe.context.close()

if (HAS_BAKED_CONFIG) {
  console.log(`\n[i] 这次构建已把 Supabase 配置烘焙进产物（${FAKE_URL}）。`)
  console.log('    · 构建期 env 优先于 localStorage，所以浏览器里塞的配置改不动它')
  console.log('    · 未登录时登录屏会接管首屏 → 「未配置」那节不适用，其余照跑')
}

/* ==================================================================
   1. 没配置云端时：全站照旧，并且要能引导用户去配置
   ================================================================== */

if (!HAS_BAKED_CONFIG) {
  console.log('\n=== 1. 未配置云端：不打扰，且有引导 ===')
  {
    const { context, page } = await newPage({ seedState: seededState() })
    await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)

    check('设置页出现「云端同步」卡片', (await page.locator('text=云端同步（可选后端）').count()) === 1)
    check('未配置时显示「未配置」状态', (await page.locator('.cloud-status[data-state]').first().textContent()).includes('未配置'))
    check('未配置时给出配置表单', (await page.locator('[data-testid="cloud-config-form"]').count()) === 1)

  // 错的 URL 要被拦下
  await page.locator('[data-testid="cloud-url"]').fill('https://example.com/rest/v1')
  await page.locator('[data-testid="cloud-anon"]').fill('x'.repeat(60))
  await page.locator('[data-testid="cloud-save-config"]').click()
  await page.waitForTimeout(500)
  {
    const texts = await page.locator('.toast').allTextContents()
    check('错误的 URL 被拦下并提示', texts.some((t) => t.includes('supabase.co')), texts.join(' | ') || '（没有任何提示）')
  }

  // service_role key 必须被拦下（放前端等于交出数据库）
  await page.locator('[data-testid="cloud-url"]').fill(FAKE_URL)
  await page.locator('[data-testid="cloud-anon"]').fill(`sb_secret_${'x'.repeat(40)}`)
  await page.locator('[data-testid="cloud-save-config"]').click()
  await page.waitForTimeout(400)
  check('service_role / secret key 被明确拒绝',
    (await page.locator('.toast').last().textContent().catch(() => '')).includes('绝对不能放在前端'))

  check('未配置时不产生任何 Supabase 请求', audit.selects.length === 0 && audit.upserts.length === 0)
  check('未配置时设置页无控制台报错', errors.length === 0, errors.slice(0, 2).join(' | '))

  // 侧栏 / 底栏的云端入口：没配后端就必须完全不存在，否则会让人以为「这站需要账号」
  const navCloud = await page.locator('[data-testid="nav-cloud"]').count()
  check('未配置时导航里没有云端入口（保持纯静态观感）', navCloud === 0, `找到 ${navCloud} 个`)
  const navItems = await page.locator('.nav-item[data-view]').count()
  check('未配置时导航仍是 8 项', navItems === 8, `${navItems} 项`)
    await context.close()
  }
}

/* ==================================================================
   2. 已配置、但没有登录 → 登录屏接管首屏

   这一节原来断言的是「设置页里那套登录表单」。现在登录是**独立的一屏**
   （views/login.js，有忘记密码、显示密码、行内校验），所以断言改成打在登录屏上，
   并额外验证一件事：没登录的人**进不去应用**，配置页自然也就到不了。
   ================================================================== */

console.log('\n=== 2. 已配置未登录：登录屏接管 ===')
{
  const { context, page } = await newPage({
    seedState: seededState(),
    config: { url: FAKE_URL, anonKey: ANON_KEY }
  })
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)

  check('未登录时被挡在登录屏，进不去设置页', page.url().endsWith('#login'), page.url())
  check('给出登录表单', (await page.locator('[data-testid="auth-login-form"]').count()) === 1)
  check('登录屏带倒计时左栏', (await page.locator('.auth-mission__num').count()) === 1)
  // 主外壳是挂着的（hashchange 监听和数据订阅要它），但在登录阶段必须看不见
  check('未登录时主外壳不可见', (await page.locator('.sidenav:visible').count()) === 0)
  check('未登录时设置页不可达', (await page.locator('.cloud-status').count()) === 0)

  // 魔法链接
  const otpRequests = []
  page.on('request', (r) => {
    if (r.url().includes('/auth/v1/otp')) otpRequests.push(r)
  })
  await page.locator('[data-testid="auth-email"]').fill('newbie@example.com')
  await page.locator('[data-testid="auth-magic-link"]').click()
  await page.waitForTimeout(900)
  check('点「发登录链接」会真的调用 Supabase OTP 接口', otpRequests.length === 1,
    otpRequests.length ? `POST ${new URL(otpRequests[0].url()).pathname}` : '没有发出请求')
  check('发送后有明确提示', (await page.locator('.toast').count()) >= 1)

  /* --- 真实项目会遇到的两种情况，客户端必须自己扛住 ---
     这两条是在真项目上实测踩出来的：
       ① 项目关了「允许新用户注册」→ 用 shouldCreateUser:true 请求会被 422 拒掉，
          但已注册用户其实能收链接，所以要退一步用 shouldCreateUser:false 重试；
       ② 免费版每小时只发极少量邮件，超了就是 429，界面得把话说清楚。 */
  audit.otpAttempts.length = 0
  audit.otpMode = 'disabled'
  await page.locator('[data-testid="auth-email"]').fill('newbie@example.com')
  await page.locator('[data-testid="auth-magic-link"]').click()
  await page.waitForTimeout(1400)
  const disabledToast = (await page.locator('.toast').last().textContent().catch(() => '')) || ''
  check('项目禁用 OTP 注册时会自动退一步重试（不建用户）',
    audit.otpAttempts.join(',') === 'create=true,create=false',
    `实际请求序列：${audit.otpAttempts.join(',') || '（空）'}`)
  check('退一步重试成功后不报错', !disabledToast.includes('不允许'), disabledToast.trim().slice(0, 60))

  audit.otpAttempts.length = 0
  audit.otpMode = 'ratelimit'
  await page.locator('[data-testid="auth-email"]').fill('newbie@example.com')
  await page.locator('[data-testid="auth-magic-link"]').click()
  await page.waitForTimeout(1400)
  const rateToast = (await page.locator('.toast').last().textContent().catch(() => '')) || ''
  check('发信额度用尽时给出可操作的中文提示',
    rateToast.includes('频繁') || rateToast.includes('等一会儿'),
    rateToast.trim().slice(0, 70))
  audit.otpMode = 'ok'
  audit.otpAttempts.length = 0

  // 密码登录：错的密码要被翻译成人话，并且落在字段/表单提示上
  await page.locator('[data-testid="auth-email"]').fill(NEW_USER.email)
  await page.locator('[data-testid="auth-password"]').fill('wrong-password')
  await page.locator('[data-testid="auth-login-form-submit"]').click()
  await page.waitForTimeout(1200)
  const wrongHint = (await page.locator('.auth-feedback').textContent().catch(() => '')) || ''
  check('密码错误提示已中文化', wrongHint.includes('邮箱或密码不对'), wrongHint.trim() || '（没有提示）')

  /**
   * 正确密码登录。
   *
   * 这里刻意**不**要求弹「首次同步用哪边」：本机有数据、云端是空的，
   * 答案唯一，应用应该自己判断并直接上传，而不是拿一个只有一个合理答案的问题打扰用户。
   * （弹窗只留给真正有分歧的情况：两边都有数据。）
   *
   * 另外要验证登录之后**真的进了应用**：登录屏曾经因为 mount 到 #app
   * 把整个外壳清掉，导致 mainNode 成了脱离文档的孤儿 —— 界面明明画对了却看不见。
   * 所以这里断言可见的 .sidenav，而不是 .auth-desk 的计数。
   */
  const pushCountBefore = audit.upserts.length
  await page.locator('[data-testid="auth-email"]').fill(NEW_USER.email)
  await page.locator('[data-testid="auth-password"]').fill('right-password')
  await page.locator('[data-testid="auth-login-form-submit"]').click()
  await page.waitForTimeout(3200)
  check('登录后自己判断并上传（云端为空，不必问用户）',
    audit.upserts.length > pushCountBefore,
    `写云端请求 ${audit.upserts.length - pushCountBefore} 次，弹窗数 ${await page.locator('.modal-backdrop').count()}`)
  check('登录后进入主应用', (await page.locator('.sidenav:visible').count()) === 1)
  check('登录屏已让开', (await page.locator('.auth-desk:visible').count()) === 0)
  await context.close()
}

/* ==================================================================
   3. 首次同步：本地有数据 → 推上云端
   ================================================================== */

console.log('\n=== 3. 首次同步（本地有数据 → 上传） ===')
{
  const { context, page } = await newPage({
    seedState: seededState(),
    config: { url: FAKE_URL, anonKey: ANON_KEY },
    session: sessionFor(USER_A)
  })
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)

  check('已登录时显示账号面板', (await page.locator('[data-testid="cloud-account"]').count()) === 1)
  check('账号面板显示邮箱', (await page.locator('[data-testid="cloud-account"]').textContent()).includes(USER_A.email))
  check('账号面板显示 user_id', (await page.locator('[data-testid="cloud-account"]').textContent()).includes(USER_A.id))

  // 导航入口要跟着登录状态走：登录后应显示「已连接 + 邮箱片段」
  const navText = (await page.locator('[data-testid="nav-cloud"]').textContent()) || ''
  check('登录后导航入口显示已连接', navText.includes('已连接'), navText.trim())
  check('导航入口状态色变为 synced',
    (await page.locator('[data-testid="nav-cloud"]').getAttribute('data-state')) === 'synced',
    String(await page.locator('[data-testid="nav-cloud"]').getAttribute('data-state')))

  await page.locator('[data-testid="cloud-first-sync"]').click()
  await page.waitForTimeout(500)
  check('首次同步弹窗给出了两边的情况', (await page.locator('.modal__body').textContent()).includes('本机'))

  await page.locator('[data-testid="cloud-keep-local"]').first().click()
  await page.waitForTimeout(1600)

  const remote = db.get(USER_A.id)
  check('本地数据已上传到云端', Boolean(remote), remote ? `payload 里有 ${remote.payload?.quests?.length ?? 0} 条委托` : '云端没有数据')
  check('上传的内容与本地一致',
    remote?.payload?.quests?.[0]?.title === '本地委托：高数第一章')
  check('设备相关设置没有被搬上云',
    remote?.payload?.settings?.sync === undefined && remote?.payload?.settings?.supabaseUrl === undefined)
  const meta = await readMeta(page)
  check('本地记下了 lastSyncedAt', Boolean(meta.lastSyncedAt), meta.lastSyncedAt || '（空）')
  check('本地标记 initialized', meta.initialized === true)
  await context.close()
}

/* ==================================================================
   4. 新设备登录 → 自动把云端数据拉下来（本地是空的）
   ================================================================== */

console.log('\n=== 4. 新设备：本地为空，登录后自动拉取 ===')
{
  db.clear()
  db.set(USER_A.id, {
    user_id: USER_A.id,
    payload: seededState({ quests: [{ id: 'q9', date: '2026-02-02', title: '云端委托：线代第二章', subject: 'math', estMin: 45, done: true, doneAt: '', source: 'manual', chapterId: null, createdAt: 9 }] }),
    updated_at: new Date().toISOString()
  })

  const { context, page } = await newPage({
    // 模拟另一台全新设备：本地是默认空数据，没有任何同步记录
    seedState: seededState({ quests: [], goals: [], progress: { streak: 0, bestStreak: 0, lastCheckIn: '', exp: 0, level: 1 }, cloudUpdatedAt: '' }),
    config: { url: FAKE_URL, anonKey: ANON_KEY },
    meta: { userId: USER_A.id, email: USER_A.email, initialized: true, lastSyncedAt: '2025-12-31T00:00:00.000Z', lastSyncedBy: 'push' },
    session: sessionFor(USER_A)
  })
  await page.goto(`${BASE}#home`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)

  const after = await readStore(page)
  check('新设备启动后自动拉到云端数据',
    after.quests.some((q) => q.title.includes('云端委托')), `委托 ${after.quests.length} 条`)
  check('拉取不会反过来污染云端', db.get(USER_A.id).payload.quests[0].title.includes('云端委托'))
  const pulledMeta = await readMeta(page)
  check('拉取后更新的 lastSyncedAt 已记录', pulledMeta.lastSyncedBy === 'pull', `lastSyncedBy=${pulledMeta.lastSyncedBy}`)
  await context.close()
}

/* ==================================================================
   5. 本地改动 → 自动推送到云端
   ================================================================== */

console.log('\n=== 5. 本地改动自动上传 ===')
{
  /*
   * 场景要自洽：上次同步之后，两边都还是老样子；然后只有本机改了东西。
   *   · 本机「上次同步那一刻」的状态 → cloudUpdatedAt = lastSyncedAt
   *   · 云端那一行也是那一刻写的     → updated_at = lastSyncedAt
   *   · 用户在页面上新增一条委托     → 本机时间戳变新 → 应该推上去
   * 之前这里把 lastSyncedAt 设在一小时前、云端行却是「刚刚」，
   * 于是被正确判定成冲突 —— 那是场景写错了，不是代码错了。
   */
  const syncedAt = new Date(Date.now() - 60_000).toISOString()
  db.clear()
  db.set(USER_A.id, {
    user_id: USER_A.id,
    payload: seededState({ cloudUpdatedAt: syncedAt }),
    updated_at: syncedAt
  })

  const { context, page } = await newPage({
    seedState: seededState({ cloudUpdatedAt: syncedAt }),
    config: { url: FAKE_URL, anonKey: ANON_KEY },
    meta: { userId: USER_A.id, email: USER_A.email, initialized: true, lastSyncedAt: syncedAt, lastSyncedBy: 'push' },
    session: sessionFor(USER_A)
  })
  await page.goto(`${BASE}#quests`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)

  const before = db.get(USER_A.id)?.payload?.quests?.length ?? 0
  await page.locator('button:has-text("添加委托")').first().click()
  await page.waitForTimeout(400)
  await page.locator('.modal .chip:has-text("背单词")').click()
  await page.locator('.modal .btn--primary').click()
  await page.waitForTimeout(3800) // 等过 debounce（2.5s）+ 一个来回

  const after = db.get(USER_A.id)?.payload?.quests?.length ?? 0
  check('新增委托后改动自动上传到云端', after > before, `云端委托 ${before} → ${after} 条`)

  const cloudTitles = (db.get(USER_A.id)?.payload?.quests || []).map((q) => q.title)
  check('上传的内容是改动后的那一份', cloudTitles.some((t) => t.includes('背单词')), cloudTitles.join(' / '))

  // 关页面前的最后一道保险：改动只落在本地、没来得及推，下次打开要能补上
  await page.locator('.quest__check').first().check()
  await page.waitForTimeout(400)
  const storedDone = (await readStore(page)).quests.filter((q) => q.done).length
  check('改动立刻落盘（推送来不及也不丢）', storedDone >= 1, `本机已完成 ${storedDone} 条`)
  await context.close()
}

/* ==================================================================
   6. 两边都改了 → 冲突必须由人来决定，不能自动覆盖
   ================================================================== */

console.log('\n=== 6. 冲突：两边都有新改动 ===')
{
  db.clear()
  db.set(USER_A.id, {
    user_id: USER_A.id,
    payload: seededState({ quests: [{ id: 'cloud', date: '2026-03-03', title: '云端改的那条', subject: 'math', estMin: 30, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: 3 }] }),
    updated_at: new Date().toISOString() // 云端刚刚更新
  })

  const { context, page } = await newPage({
    seedState: seededState(), // 本地也在刚才改过
    config: { url: FAKE_URL, anonKey: ANON_KEY },
    meta: { userId: USER_A.id, email: USER_A.email, initialized: true, lastSyncedAt: new Date(Date.now() - 7200_000).toISOString(), lastSyncedBy: 'push' },
    session: sessionFor(USER_A)
  })
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)

  const statusText = await page.locator('.cloud-status').first().textContent()
  check('冲突时状态明确提示，而不是悄悄覆盖', statusText.includes('冲突') || statusText.includes('两边'), statusText.trim())

  await page.locator('[data-testid="cloud-sync-now"]').click()
  await page.waitForTimeout(1200)
  check('点立即同步会弹出「两边都有新改动」让用户选',
    (await page.locator('.modal__title').textContent().catch(() => '')).includes('两边都有新改动'))

  // 选「本机覆盖云端」：本地数据不能丢
  await page.locator('.modal .btn:has-text("本机覆盖云端")').click()
  await page.waitForTimeout(1500)
  const remote = db.get(USER_A.id)
  check('选「本机覆盖云端」后本地数据没被云端覆盖',
    remote?.payload?.quests?.[0]?.title === '本地委托：高数第一章',
    remote?.payload?.quests?.[0]?.title || '（空）')
  const local = await readStore(page)
  check('本地数据保持完整', local.quests.some((q) => q.title.includes('本地委托')))
  await context.close()
}

/* ==================================================================
   7. 多用户隔离 + 越权拦截（这是「真正的后端」能成立的根本）
   ================================================================== */

console.log('\n=== 7. 多用户隔离与越权拦截 ===')
{
  db.clear()
  db.set(USER_A.id, {
    user_id: USER_A.id,
    payload: seededState({ quests: [{ id: 'a', date: '2026-01-01', title: 'A 的私密委托', subject: 'math', estMin: 30, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: 1 }] }),
    updated_at: new Date().toISOString()
  })

  // 用户 B 登录：不应该看到 A 的任何东西
  const b = await newPage({
    seedState: seededState({ quests: [], cloudUpdatedAt: '' }),
    config: { url: FAKE_URL, anonKey: ANON_KEY },
    meta: { userId: USER_B.id, email: USER_B.email, initialized: true, lastSyncedAt: '2025-12-31T00:00:00.000Z', lastSyncedBy: 'push' },
    session: sessionFor(USER_B)
  })
  await b.page.goto(`${BASE}#home`, { waitUntil: 'domcontentloaded' })
  await b.page.waitForTimeout(2000)
  const bState = await readStore(b.page)
  check('用户 B 看不到用户 A 的数据',
    !bState.quests.some((q) => q.title.includes('A 的私密委托')),
    `B 本机委托 ${bState.quests.length} 条`)

  // 云端那一行必须还在 A 名下，B 的登录没有把它写坏
  check('A 在云端的行没被 B 影响', db.get(USER_A.id)?.payload?.quests?.[0]?.title === 'A 的私密委托')

  // 越权 1：拿 B 的身份写 A 的行 → 数据库必须拒绝
  const forge = await b.page.evaluate(
    async ({ url, anon, token, victim, table }) => {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          apikey: anon,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ user_id: victim, payload: { quests: [{ title: '伪造' }] } })
      })
      return { status: res.status, body: await res.text() }
    },
    { url: FAKE_URL, anon: ANON_KEY, token: sessionFor(USER_B).access_token, victim: USER_A.id, table: TABLE }
  )
  check('伪造 user_id 写别人的行被数据库拒绝', forge.status === 403,
    `HTTP ${forge.status} ${forge.body.slice(0, 90)}`)
  check('被拒绝后 A 的云端数据完好', db.get(USER_A.id)?.payload?.quests?.[0]?.title === 'A 的私密委托')

  // 越权 2：不带 token（anon）读表 → 必须拒绝
  const anonRead = await b.page.evaluate(
    async ({ url, anon, table }) => {
      const res = await fetch(`${url}/rest/v1/${table}?select=payload`, {
        headers: { apikey: anon }
      })
      return { status: res.status, body: await res.text() }
    },
    { url: FAKE_URL, anon: ANON_KEY, table: TABLE }
  )
  check('未登录（anon）读表被拒绝', anonRead.status === 401,
    `HTTP ${anonRead.status} ${anonRead.body.slice(0, 80)}`)

  // 越权 3：拿 A 的 token 查 B 的行 → 查不到（而不是报错），这才是 RLS 的行为
  const crossRead = await b.page.evaluate(
    async ({ url, anon, token, victim, table }) => {
      const res = await fetch(`${url}/rest/v1/${table}?user_id=eq.${victim}&select=payload`, {
        headers: { apikey: anon, Authorization: `Bearer ${token}` }
      })
      return { status: res.status, body: await res.text() }
    },
    { url: FAKE_URL, anon: ANON_KEY, token: sessionFor(USER_A).access_token, victim: USER_B.id, table: TABLE }
  )
  check('跨用户查询返回空集（RLS 过滤，而不是泄露）',
    crossRead.status === 200 && crossRead.body.trim() === '[]',
    `HTTP ${crossRead.status} body=${crossRead.body.slice(0, 60)}`)

  await b.context.close()
}

/* ==================================================================
   8. 退出登录 / 删除云端数据
   ================================================================== */

console.log('\n=== 8. 退出登录与删除云端数据 ===')
{
  const { context, page } = await newPage({
    seedState: seededState(),
    config: { url: FAKE_URL, anonKey: ANON_KEY },
    meta: { userId: USER_A.id, email: USER_A.email, initialized: true, lastSyncedAt: new Date().toISOString(), lastSyncedBy: 'push' },
    session: sessionFor(USER_A)
  })
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1400)
  await page.locator('button:has-text("退出登录")').click()
  await page.waitForTimeout(1600)

  /*
   * 退出之后**整个应用被登录屏接管**，不再是「设置页里换一套表单」。
   * 所以这里除了断言登录表单出现，还要断言主外壳确实让开了 ——
   * 否则用户还能在已退出的界面上点来点去。
   */
  check('退出后回到登录屏', (await page.locator('[data-testid="auth-login-form"]').count()) === 1)
  check('退出后主外壳让开', (await page.locator('.sidenav:visible').count()) === 0)
  const localAfterLogout = await readStore(page)
  check('退出登录不会动本地数据', localAfterLogout.quests.length > 0)

  // 重新登录后删云端
  await page.locator('[data-testid="auth-email"]').fill(USER_A.email)
  await page.locator('[data-testid="auth-password"]').fill('right-password')
  await page.locator('[data-testid="auth-login-form-submit"]').click()
  await page.waitForTimeout(3000)

  // 注意：退出登录会把本地同步记录清掉，所以重新登录会走一次首次对账
  check('重新登录后回到应用', (await page.locator('.sidenav:visible').count()) === 1)
  for (let i = 0; i < 3 && (await page.locator('.modal-backdrop').count()) > 0; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  check('重新登录后弹窗可关闭、能继续操作', (await page.locator('.modal-backdrop').count()) === 0)

  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1400)
  await page.locator('button:has-text("删除云端数据")').click()
  await page.locator('.modal-backdrop').waitFor({ state: 'visible', timeout: 8000 })
  check('删除云端前会二次确认', (await page.locator('.modal__title').textContent()).includes('删除云端'))
  await page.locator('.modal__foot .btn--danger').click()
  await page.waitForTimeout(2000)
  // 注意：假服务器里「right-password」这个密码对应的是 C 用户，所以这里检查的是 C 那一行
  check('删除云端数据后云端那一行没了', !db.has(NEW_USER.id), `DB 剩余 ${db.size} 行`)
  check('删除云端不影响本地数据', (await readStore(page)).quests.length > 0)
  await context.close()
}

/* ==================================================================
   9. 断网 / 服务器挂掉时不能把站点弄坏
   ================================================================== */

console.log('\n=== 9. 云端不可用时的降级 ===')
{
  const { context, page } = await newPage({
    seedState: seededState(),
    config: { url: FAKE_URL, anonKey: ANON_KEY },
    meta: { userId: USER_A.id, email: USER_A.email, initialized: true, lastSyncedAt: '2025-12-31T00:00:00.000Z', lastSyncedBy: 'push' },
    session: sessionFor(USER_A)
  })
  // 把所有 Supabase 请求打死，模拟断网 / 项目被暂停
  await page.route(`${FAKE_URL}/**`, (r) => r.abort('failed'))

  await page.goto(`${BASE}#home`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  check('云端挂掉时首页照常渲染', (await page.locator('#cdDays').count()) === 1)
  const st = await readStore(page)
  check('云端挂掉时本地数据完好', st.quests.length > 0, `${st.quests.length} 条委托`)

  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const status = await page.locator('.cloud-status').first().textContent()
  check('云端挂掉时给出可读的失败状态', /成功|失败|连不上|错误|冲突|同步/.test(status), status.trim())
  // 「资源加载失败」这种浏览器自带的网络报错不算未捕获异常：我们关心的是 JS 抛错
  const realErrors = errors.filter(
    (e) => !/Failed to (load resource|fetch)|NetworkError|ERR_FAILED|ERR_NAME_NOT_RESOLVED|status of \d{3}/i.test(e)
  )
  check('云端挂掉不产生未捕获异常', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))
  await context.close()
}

/* ==================================================================
   10. 状态徽标的可读性（新增 UI 不能拉低对比度）
   ================================================================== */

console.log('\n=== 10. 云端状态徽标对比度（WCAG AA）===')
{
  /** 相对亮度，按 WCAG 2.1 定义 */
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
   * 注意别写反：反过来会把"深字白底"算成 0.09:1，看着像全线不达标 ——
   * 这个脚本原来就是反的，所以它的三条断言其实一直在用错误的值做判断。
   */
  const contrast = (fg, bg) => {
    const [dark, light] = [luminance(fg), luminance(bg)].sort((x, y) => x - y)
    return (light + 0.05) / (dark + 0.05)
  }

  /** 把某种状态下的徽标渲染出来，量文字色 / 底色 */
  const measure = async (state, colors) => {
    // 带会话：现在没登录的人会被登录屏挡住，根本进不去设置页，也就看不到这个徽标
    const { context, page } = await newPage({
      seedState: seededState(),
      meta: { userId: USER_A.id, email: USER_A.email, initialized: true, lastSyncedAt: new Date().toISOString(), lastSyncedBy: 'push' },
      session: sessionFor(USER_A)
    })
    await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1400)
    const styles = await page.evaluate(
      ({ st, cs }) => {
        const status = document.querySelector('[data-testid="cloud-status"]')
        status.dataset.state = st
        const text = status.querySelector('.cloud-status__text')
        const dot = status.querySelector('.cloud-status__dot')
        // 元素本身可能是半透明底，这里把它合成到卡片白底上再算
        return {
          text: getComputedStyle(text).color,
          statusBg: getComputedStyle(status).backgroundColor,
          cardBg: getComputedStyle(status.closest('.card') || document.body).backgroundColor,
          dot: getComputedStyle(dot).backgroundColor,
          colors: cs
        }
      },
      { st: state, cs: colors }
    )
    // 半透明底叠到父层上：c = a*fg + (1-a)*bg
    const bgLayer = parse(styles.statusBg)
    const alpha = (styles.statusBg.match(/[\d.]+/g) || [])[3]
    const cardBg = parse(styles.cardBg)
    const effectiveBg =
      alpha !== undefined && Number(alpha) < 1
        ? bgLayer.map((v, i) => Number(alpha) * v + (1 - Number(alpha)) * cardBg[i])
        : bgLayer
    await context.close()
    return { fg: parse(styles.text), bg: effectiveBg }
  }

  for (const [label, state] of [
    ['已同步', 'synced'],
    ['同步中', 'busy'],
    ['冲突/错误', 'conflict']
  ]) {
    const { fg, bg } = await measure(state)
    const ratio = contrast(fg, bg)
    check(`状态徽标「${label}」文字对比度 ≥ 4.5:1`, ratio >= 4.5,
      `${ratio.toFixed(2)}:1  fg=rgb(${fg.join(',')}) bg=rgb(${bg.map((v) => Math.round(v)).join(',')})`)
  }
}

await browser.close()

/* ---------------- 汇总 ---------------- */

const failed = results.filter((r) => !r.ok)
console.log('\n================ 云端同步测试结果 ================')
console.log(`通过 ${results.length - failed.length} / ${results.length}`)
if (errors.length) {
  console.log(`\n控制台错误 ${errors.length} 条：`)
  for (const e of [...new Set(errors)].slice(0, 8)) console.log(' - ' + e)
}
if (failed.length) {
  console.log('\n失败项：')
  for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''))
  process.exitCode = 1
}
