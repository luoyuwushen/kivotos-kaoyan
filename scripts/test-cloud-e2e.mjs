/**
 * 浏览器端到端联调（打真项目、走真 UI）。
 *
 *   node scripts/test-cloud-e2e.mjs --admin-token sbp_xxx [--proxy http://127.0.0.1:7897]
 *
 * 和 test-cloud-live.mjs 的区别：
 *   · test-cloud-live 直接打 REST/Auth 接口，验证**后端**（RLS、隔离、越权）
 *   · 这个脚本开真浏览器、点真界面，验证**前端同步逻辑**跑在真后端上：
 *       1. 在设置页用邮箱+密码登录
 *       2. 首次同步：把本机数据上传覆盖云端
 *       3. 云端真的收到了（用 Admin/REST 独立核对，不信界面自报）
 *       4. 换一台「新设备」（全新浏览器上下文 + 空的本地数据）登录同一账号
 *       5. 新设备**自动**把云端数据拉下来 —— 这就是跨设备同步的实证
 *       6. 另一个账号登录，看不到第一份数据（隔离）
 *
 * 说明：脚本会建两个已确认的测试账号，跑完连账号带数据一起删掉。
 * 需要大陆网络环境下给个代理：--proxy http://127.0.0.1:7897
 */

import { chromium } from 'playwright'

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const BASE = arg('base', 'http://127.0.0.1:4173/')
const TOKEN = arg('admin-token') || process.env.SUPABASE_ACCESS_TOKEN || ''
const PROXY = arg('proxy') || process.env.HTTPS_PROXY || ''
const TABLE = 'kaoyan_data'
const CFG_KEY = 'kivotos-kaoyan-cloud-cfg-v1'
const META_KEY = 'kivotos-kaoyan-cloud-meta-v1'
const STORE_KEY = 'kivotos-kaoyan-v1'

if (!TOKEN) {
  console.log('缺少 --admin-token（sbp_ 开头）。用法：node scripts/test-cloud-e2e.mjs --admin-token sbp_xxx [--proxy http://127.0.0.1:7897]')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}
const info = (t) => console.log(`  ·  ${t}`)

/* ---------------- 读产物里的配置（客户端真正会用的那份） ---------------- */
const { readFileSync } = await import('node:fs')
const envText = ['\.env', '.env.local'].map((f) => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}).join('\n')
const PROJ = (/VITE_SUPABASE_URL\s*=\s*(\S+)/.exec(envText)?.[1] || '').replace(/\/+$/, '')
const ANON = /VITE_SUPABASE_ANON_KEY\s*=\s*(\S+)/.exec(envText)?.[1] || ''
if (!PROJ || !ANON) {
  console.log('读不到 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY —— 这个脚本需要构建时烘焙了配置（.env.local）。')
  process.exit(1)
}
info(`目标项目：${PROJ}`)
info(`代理：${PROXY || '（不用代理）'}`)

const REF = new URL(PROJ).hostname.split('.')[0]
const api = (path, init = {}) =>
  fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(60000)
  })

/* ---------------- 取 service_role key，用来建/删测试账号 ---------------- */
const keysRes = await api('/api-keys?reveal=true')
if (!keysRes.ok) {
  console.log(`取 service_role key 失败（HTTP ${keysRes.status}）—— token 对吗？`)
  process.exit(1)
}
const SERVICE = (await keysRes.json()).find((k) => k.name === 'service_role' || k.type === 'secret')?.api_key
if (!SERVICE) {
  console.log('响应里没有 service_role key')
  process.exit(1)
}

const stamp = Date.now().toString(36)
const mailDomain = `test.${REF}.supabase.co`
const users = {
  A: { email: `kaoyan-e2e-${stamp}-a@${mailDomain}`, password: `Kaoyan-${stamp}-Aa1` },
  B: { email: `kaoyan-e2e-${stamp}-b@${mailDomain}`, password: `Kaoyan-${stamp}-Bb2` }
}

async function createUser(u) {
  const res = await fetch(`${PROJ}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true }),
    signal: AbortSignal.timeout(45000)
  })
  const json = await res.json().catch(() => null)
  u.id = json?.id || ''
  return { status: res.status, id: u.id }
}

async function deleteUser(id) {
  if (!id) return
  await fetch(`${PROJ}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    signal: AbortSignal.timeout(30000)
  }).catch(() => {})
}

/** 独立核对云端那一行到底存了什么（不信界面自报） */
async function readCloudRow(user) {
  const login = await fetch(`${PROJ}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
    signal: AbortSignal.timeout(45000)
  })
  const session = await login.json().catch(() => null)
  if (!session?.access_token) return { error: `登录失败（HTTP ${login.status}）`, raw: JSON.stringify(session).slice(0, 120) }
  const res = await fetch(`${PROJ}/rest/v1/${TABLE}?select=payload,updated_at`, {
    headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(45000)
  })
  const rows = await res.json().catch(() => null)
  return { row: Array.isArray(rows) ? rows[0] : null, total: Array.isArray(rows) ? rows.length : -1 }
}

/* ---------------- 浏览器 ---------------- */
const browser = await chromium.launch({
  proxy: PROXY ? { server: PROXY, bypass: '127.0.0.1,localhost' } : undefined
})

function seedState(quests) {
  return {
    version: 1,
    profile: { nickname: 'E2E', siteName: '基沃托斯作战本部', examDate: '2027-12-26', subjectSet: 'math1', dailyGoalMin: 360 },
    quests,
    phases: [], chapters: [], focus: [], mistakes: [], goals: [], scores: [],
    progress: { streak: 0, bestStreak: 0, lastCheckIn: '', exp: 0, level: 1 },
    medals: { unlocked: {} },
    settings: {
      theme: 'light', mascots: { hoshino: true, arona: true, plana: true, speech: true },
      customCharacters: false, aiApi: { baseUrl: '', apiKey: '', model: '', enabled: false },
      sync: { gistToken: '', gistId: '' }, supabaseUrl: '', supabaseAnon: '', cloud: { autoPush: true }
    },
    onboarded: true,
    cloudUpdatedAt: new Date().toISOString()
  }
}

async function newDevice(seed) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = []
  const logs = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'warning' && (text.includes('[cloud]') || text.includes('[settings:debug]'))) logs.push(text)
  })
  await page.addInitScript(({ key, state }) => {
    // 打开 cloud.js 的同步判定日志，方便定位「为什么没同步」
    localStorage.setItem('kivotos-kaoyan-cloud-debug', '1')
    if (state) localStorage.setItem(key, JSON.stringify(state))
  }, { key: STORE_KEY, state: seed })
  return { context, page, errors, logs }
}

/** 走真界面登录 */
async function uiSignIn(page, user) {
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.locator('[data-testid="cloud-email"]').fill(user.email)
  await page.locator('[data-testid="cloud-password"]').fill(user.password)
  await page.locator('[data-testid="cloud-password-login"]').click()
  await page.waitForTimeout(6000)
}

/** 首次同步弹窗出现时，选「保留本机」 */
async function keepLocalIfAsked(page) {
  if ((await page.locator('[data-testid="cloud-keep-local"]').count()) > 0) {
    await page.locator('[data-testid="cloud-keep-local"]').first().click()
    await page.waitForTimeout(2500)
    return true
  }
  return false
}

/* ================= 开跑 ================= */

console.log('\n--- 建两个测试账号 ---')
const a = await createUser(users.A)
const b = await createUser(users.B)
check('测试账号 A 已创建（邮箱已确认）', Boolean(a.id), a.id || `HTTP ${a.status}`)
check('测试账号 B 已创建（邮箱已确认）', Boolean(b.id), b.id || `HTTP ${b.status}`)

try {
  /* ---------- 设备 1：本机有数据 → 登录 → 上传 ---------- */
  console.log('\n--- 设备 1：登录并把本机数据同步上去 ---')
  const d1 = await newDevice(
    seedState([
      { id: 'e2e-1', date: '2026-01-01', title: 'E2E 本机委托：高数第一章', subject: 'math', estMin: 60, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: 1 },
      { id: 'e2e-2', date: '2026-01-01', title: 'E2E 本机委托：英语阅读', subject: 'english', estMin: 30, done: true, doneAt: '2026-01-01T10:00:00.000Z', source: 'manual', chapterId: null, createdAt: 2 }
    ])
  )
  await uiSignIn(d1.page, users.A)
  const accountPanel = (await d1.page.locator('[data-testid="cloud-account"]').count()) === 1
  check('界面登录成功（出现账号面板）', accountPanel)
  /**
   * 这里刻意**不要求**弹「保留哪一边」：
   * 本机有数据、云端是空的，这种情况答案唯一，应用应该自己判断并直接上传，
   * 而不是拿一个只有一个合理答案的问题去打扰用户。（弹窗留给真正有分歧的情况。）
   */
  const asked1 = (await d1.page.locator('[data-testid="cloud-keep-local"]').count()) > 0
  check('本机有数据 + 云端为空 → 应用自己判断，不弹窗打扰', !asked1)
  await d1.page.waitForTimeout(3000)

  const cloudA = await readCloudRow(users.A)
  check('云端真的收到了本机数据（独立核对，不看界面自报）',
    cloudA.row?.payload?.quests?.some((q) => q.title.includes('E2E 本机委托')),
    cloudA.row ? `${cloudA.row.payload?.quests?.length ?? 0} 条委托` : cloudA.error || '云端没有这一行')
  check('云端只有这一行（隔离的基本盘）', cloudA.total === 1, `共 ${cloudA.total} 行`)

  /* ---------- 界面上的状态也要对 ---------- */
  const navText = (await d1.page.locator('[data-testid="nav-cloud"]').textContent().catch(() => '')) || ''
  check('导航上的云端入口显示已连接', navText.includes('已连接'), navText.trim())
  const meta = await d1.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), META_KEY)
  check('本机记下了同步时间与账号', Boolean(meta.lastSyncedAt) && meta.initialized === true,
    `lastSyncedBy=${meta.lastSyncedBy}`)
  await d1.context.close()

  /* ---------- 设备 2：全新设备、本地空 → 登录 → 自动拉取 ---------- */
  console.log('\n--- 设备 2（全新设备，本地为空）：登录后应自动拉到云端数据 ---')
  const d2 = await newDevice(
    seedState([]) // 本机什么都没有
  )
  await uiSignIn(d2.page, users.A)
  // 先确认登录到底成没成 —— 不然下面的失败会指向错的地方
  const d2LoggedIn = (await d2.page.locator('[data-testid="cloud-account"]').count()) === 1
  check('新设备能用同一账号登录', d2LoggedIn)
  if (!d2LoggedIn) {
    const st = (await d2.page.locator('[data-testid="cloud-status"]').textContent().catch(() => '(读不到)')) || ''
    const toast = (await d2.page.locator('.toast').allTextContents().catch(() => [])).join(' | ')
    info(`状态徽标：${st.trim()}`)
    info(`界面提示：${toast.slice(0, 160) || '（无）'}`)
  }
  // 本地是空的，不该问方向，应该直接拉
  const asked2 = (await d2.page.locator('[data-testid="cloud-keep-local"]').count()) > 0
  check('新设备本地为空时不打扰用户（不问方向，直接拉）', !asked2)
  if (asked2) {
    const title = (await d2.page.locator('.modal__title').textContent().catch(() => '(无标题)')) || ''
    const metaNow = await d2.page.evaluate((k) => localStorage.getItem(k), META_KEY)
    const localNow = await d2.page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k) || '{}')
      return { quests: (s.quests || []).length, cloudUpdatedAt: s.cloudUpdatedAt, onboarded: s.onboarded }
    }, STORE_KEY)
    info(`弹的是哪个窗：${title.trim()}`)
    info(`cloudMeta：${metaNow || '(空)'}`)
    info(`本机数据：${JSON.stringify(localNow)}`)
    info(`同步日志：${d2.logs.join(' ⟂ ').slice(0, 400) || '(没有 cloud 日志)'}`)
  }
  await d2.page.waitForTimeout(3500)

  const pulled = await d2.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), STORE_KEY)
  const titles = (pulled.quests || []).map((q) => q.title)
  check('新设备自动拿到了云端数据',
    titles.some((t) => t.includes('E2E 本机委托')),
    titles.length ? titles.join(' / ') : '本机委托仍是空的')
  const d2meta = await d2.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), META_KEY)
  check('新设备记录了「这是一次拉取」', d2meta.lastSyncedBy === 'pull', `lastSyncedBy=${d2meta.lastSyncedBy}`)
  check('设备 1/2 全程无未捕获异常', d1.errors.length === 0 && d2.errors.length === 0,
    [...d1.errors, ...d2.errors].slice(0, 2).join(' | '))
  await d2.context.close()

  /* ---------- 设备 3：另一个账号，看不到 A 的数据 ---------- */
  console.log('\n--- 设备 3：换账号登录，应看不到前一个账号的数据 ---')
  const d3 = await newDevice(seedState([]))
  await uiSignIn(d3.page, users.B)
  await d3.page.waitForTimeout(3500)
  const bState = await d3.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), STORE_KEY)
  check('B 账号看不到 A 的数据',
    !(bState.quests || []).some((q) => q.title.includes('E2E 本机委托')),
    `B 本机委托 ${(bState.quests || []).length} 条`)
  const cloudB = await readCloudRow(users.B)
  check('云端仍只有 A 那一行（B 没把 A 的行弄坏）', cloudB.total <= 1, `B 视角可见 ${cloudB.total} 行`)
  await d3.context.close()
} finally {
  /* ---------- 清理 ---------- */
  console.log('\n--- 清理测试账号 ---')
  await deleteUser(a.id)
  await deleteUser(b.id)
  await browser.close()
  info('已删除两个测试账号及其数据')
}

/* ================= 汇总 ================= */
const failed = results.filter((r) => !r.ok)
console.log('\n============ 浏览器端到端（真项目）============')
console.log(`通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length) {
  console.log('\n失败项：')
  for (const f of failed) console.log(` - ${f.name}${f.detail ? ' — ' + f.detail : ''}`)
  process.exitCode = 1
} else {
  console.log('\n跨设备同步在真后端上跑通了。别忘了 Revoke 掉这次的 token。')
}
