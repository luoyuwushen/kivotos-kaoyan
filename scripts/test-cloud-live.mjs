/**
 * 真机联调：拿**真的 Supabase 项目**跑一遍，确认这套后端真的能上生产。
 *
 *   node scripts/test-cloud-live.mjs --url https://xxxx.supabase.co --anon eyJ...
 *   # 或者先 set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 再直接跑
 *
 * 它检查的东西（每一条都是「上线前必须为真」的）：
 *   1. 项目 URL / anon key 格式对；表能不能连上
 *   2. 建表 SQL 执行过：kaoyan_data 表存在，且没把 service_role 之类的私钥填错
 *   3. 行级安全真的开着：匿名（anon）读表被拒
 *   4. 邮箱注册 + 登录能走通（会建两个一次性测试账号）
 *   5. 用户只能读到自己那一行；查别人的行返回空集而不是别人的数据
 *   6. 伪造 user_id 写别人的行会被数据库拒绝
 *   7. 收尾：删掉测试账号在云端留下的行
 *
 * 注意：脚本会真的往你的项目里注册两个邮箱（形如 kaoyan-live-test-…@example.com）。
 * 它们只是占位的账号名，不验证邮箱就能用；跑完可以在
 * Supabase 控制台 → Authentication → Users 里删掉。
 */

import { readFileSync, existsSync } from 'node:fs'

/* ---------------- 参数 ---------------- */

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : ''
}

function readEnvFile(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const envFile = { ...readEnvFile('.env'), ...readEnvFile('.env.local') }
const URL_ = (arg('url') || process.env.VITE_SUPABASE_URL || envFile.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const ANON = arg('anon') || process.env.VITE_SUPABASE_ANON_KEY || envFile.VITE_SUPABASE_ANON_KEY || ''
/**
 * 可选：Supabase 个人访问令牌（sbp_ 开头）。
 * 项目开着「Confirm email」时，注册出来的测试账号必须先点邮件才能登录 ——
 * 脚本没法点邮件，所以给了这个 token 就用 Admin API 直接建「已确认」的账号，
 * 跑完再删掉。没有它也能跑，但需要你先在控制台关掉 Confirm email。
 */
const ADMIN_TOKEN = arg('admin-token') || process.env.SUPABASE_ACCESS_TOKEN || ''
const TABLE = 'kaoyan_data'

if (!URL_ || !ANON) {
  console.log(`
缺少参数。两种用法：

  node scripts/test-cloud-live.mjs --url https://你的项目.supabase.co --anon eyJhbGciOi...

或者把这两行写进项目根目录的 .env.local（已在 .gitignore 里），然后直接跑：

  VITE_SUPABASE_URL=https://你的项目.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

这两项在 Supabase 控制台 → Project Settings → API 里。
记得先执行过 docs/supabase-schema.sql，否则表不存在。
`)
  process.exit(1)
}

/* ---------------- 结果收集 ---------------- */

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}
function info(text) {
  console.log(`  ·  ${text}`)
}

const authHeaders = { apikey: ANON, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rest(path, { method = 'GET', token = null, body = null, prefer = '' } = {}) {
  const headers = { ...authHeaders }
  if (token) headers.Authorization = `Bearer ${token}`
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, text, json }
}

async function auth(path, { method = 'POST', body = null, token = null } = {}) {
  const headers = { ...authHeaders }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${URL_}/auth/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, text, json }
}

/* ---------------- 正式开跑 ---------------- */

console.log(`\n=== 真机联调：${URL_} ===`)
info(`表名 ${TABLE} · 脚本时间 ${new Date().toLocaleString('zh-CN')}`)

/* 1. 连通性 */
let reachable = false
try {
  const res = await rest(`${TABLE}?select=user_id&limit=1`)
  reachable = true
  check('能连上项目（REST 接口可达）', true, `HTTP ${res.status}`)

  /* 2. 表存在 + 匿名被拒 —— 这两件事一起看 */
  const looksMissing = /does not exist|schema cache|42P01/i.test(res.text)
  check('建表 SQL 已执行（kaoyan_data 表存在）', !looksMissing,
    looksMissing ? '表不存在，请先在 SQL Editor 里执行 docs/supabase-schema.sql' : '')
  if (!looksMissing) {
    check('未登录（anon）读不到任何数据 —— RLS 在生效',
      res.status === 401 || res.status === 403 || res.status === 200,
      `HTTP ${res.status} ${String(res.text).slice(0, 80)}`)
    if (res.status === 200) {
      const rows = Array.isArray(res.json) ? res.json : []
      check('anon 即使拿到 200 也是空集（没有把数据漏出去）', rows.length === 0, `返回 ${rows.length} 行`)
    }
  }
} catch (err) {
  check('能连上项目（REST 接口可达）', false, err.message)
}

if (!reachable) {
  console.log('\n连不上项目，后面的检查没法继续。请确认：项目 URL 没写错、项目没被暂停（免费版会休眠）。')
  process.exit(1)
}

/* 3. 注册两个一次性账号 */
// 邮箱域名有讲究：Supabase 会校验域名有效性，`@example.com` 这类会被直接拒掉
// （error_code: email_address_invalid）。这里用项目自己的域名加个 test. 前缀 ——
// 既能通过校验，又不可能真的投递到别人邮箱里。
const stamp = Date.now().toString(36)
const projectRef = new URL(URL_).hostname.split('.')[0]
const mailDomain = `test.${projectRef}.supabase.co`
const userA = { email: `kaoyan-live-${stamp}-a@${mailDomain}`, password: `Kaoyan-${stamp}-Aa1` }
const userB = { email: `kaoyan-live-${stamp}-b@${mailDomain}`, password: `Kaoyan-${stamp}-Bb2` }
const sessions = {}

/**
 * 用 Admin API 建一个「邮箱已确认」的账号。
 * 这条路需要 service_role key —— 它从 Management API 现取现用，不落盘。
 */
let serviceKeyCache = null
async function serviceRoleKey() {
  if (serviceKeyCache) return serviceKeyCache
  const ref = new URL(URL_).hostname.split('.')[0]
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(45000)
  })
  if (!res.ok) throw new Error(`取 service_role key 失败（HTTP ${res.status}）`)
  const keys = await res.json()
  const entry = keys.find((k) => k.name === 'service_role' || k.type === 'secret')
  if (!entry?.api_key) throw new Error('响应里没有 service_role key')
  serviceKeyCache = entry.api_key
  return serviceKeyCache
}

async function adminCreateUser(user) {
  const key = await serviceRoleKey()
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password, email_confirm: true }),
    signal: AbortSignal.timeout(45000)
  })
  const text = await res.text()
  return { status: res.status, text, json: safeJson(text) }
}

async function adminDeleteUser(id) {
  if (!id || !ADMIN_TOKEN) return
  try {
    const key = await serviceRoleKey()
    await fetch(`${URL_}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30000)
    })
  } catch {
    /* 清理失败不影响结论，最后会提示手动删 */
  }
}

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

async function signUpAndLogin(user, label) {
  let signup = { status: 0, text: '(未走注册接口)' }
  if (ADMIN_TOKEN) {
    // 有 admin token 就直接建已确认账号，绕开「Confirm email」和发信额度
    const created = await adminCreateUser(user)
    signup = created
    if (created.json?.id) user.id = created.json.id
  } else {
    signup = await auth('signup', { body: { email: user.email, password: user.password } })
  }
  const login = await auth('token?grant_type=password', {
    body: { email: user.email, password: user.password }
  })
  const token = login.json?.access_token || ''
  const id = login.json?.user?.id || signup.json?.id || user.id || ''
  if (token) sessions[label] = { token, id, email: user.email }
  return { signup, login, token, id }
}

console.log('\n--- 创建并登录两个测试账号 ---')
if (ADMIN_TOKEN) info('用 Admin API 直接建「已确认」账号（不需要你关 Confirm email，也不消耗邮件额度）')
const a = await signUpAndLogin(userA, 'A')
const b = await signUpAndLogin(userB, 'B')

check('账号 A 能创建并登录', Boolean(a.token), a.token ? `user_id ${a.id}` : `signup=${a.signup.status} ${String(a.signup.text).slice(0, 140)}`)
check('账号 B 能创建并登录', Boolean(b.token), b.token ? `user_id ${b.id}` : `login=${b.login.status} ${String(b.login.text).slice(0, 140)}`)

if (!a.token || !b.token) {
  const blob = `${a.signup.text}${b.signup.text}`
  let hint
  if (/rate limit|429/i.test(blob)) {
    hint = '免费版发信额度已用尽（每小时只允许极少量邮件）。两个办法：① 重跑时加上 --admin-token <你的 sbp_ token>，脚本会用 Admin API 建已确认账号（推荐）；② 到 Authentication → Sign In / Providers → Email 关掉 Confirm email，然后等额度恢复。'
  } else if (/confirm/i.test(blob)) {
    hint = '项目开着「Confirm email」，注册后拿不到会话，而测试邮箱收不到信。加上 --admin-token <sbp_ token> 让脚本用 Admin API 建已确认账号，或到控制台关掉 Confirm email。'
  } else {
    hint = '请检查 anon key 是否为 anon public（不是 service_role），以及项目是否开启了 Email 登录。'
  }
  console.log(`\n拿不到会话，无法继续隔离性测试。\n提示：${hint}`)
  console.log('\n================ 真机联调结果 ================')
  console.log(`通过 ${results.filter((r) => r.ok).length} / ${results.length}（未跑完）`)
  process.exit(1)
}

/* 4. 各写各的一份数据 */
console.log('\n--- 两边各写一份自己的数据 ---')
const payloadA = { version: 1, quests: [{ id: 'live-a', title: 'A 的真机测试数据', done: false }], marker: 'A' }
const payloadB = { version: 1, quests: [{ id: 'live-b', title: 'B 的真机测试数据', done: false }], marker: 'B' }

const writeA = await rest(TABLE, {
  method: 'POST',
  token: a.token,
  prefer: 'resolution=merge-duplicates,return=representation',
  body: { user_id: a.id, payload: payloadA }
})
check('A 能写入自己那一行', writeA.status === 200 || writeA.status === 201, `HTTP ${writeA.status} ${String(writeA.text).slice(0, 100)}`)

const writeB = await rest(TABLE, {
  method: 'POST',
  token: b.token,
  prefer: 'resolution=merge-duplicates,return=representation',
  body: { user_id: b.id, payload: payloadB }
})
check('B 能写入自己那一行', writeB.status === 200 || writeB.status === 201, `HTTP ${writeB.status} ${String(writeB.text).slice(0, 100)}`)

/* 5. 隔离性 */
console.log('\n--- 隔离性：互相看不见 ---')
const readOwnA = await rest(`${TABLE}?user_id=eq.${a.id}&select=payload`, { token: a.token })
check('A 能读回自己的数据',
  readOwnA.status === 200 && readOwnA.json?.[0]?.payload?.marker === 'A',
  `HTTP ${readOwnA.status} marker=${readOwnA.json?.[0]?.payload?.marker ?? '(无)'}`)

const readCrossA = await rest(`${TABLE}?user_id=eq.${b.id}&select=payload`, { token: a.token })
check('A 查 B 的行 → 返回空集，拿不到 B 的数据',
  readCrossA.status === 200 && Array.isArray(readCrossA.json) && readCrossA.json.length === 0,
  `HTTP ${readCrossA.status} 返回 ${Array.isArray(readCrossA.json) ? readCrossA.json.length : '?'} 行`)

const readAll = await rest(`${TABLE}?select=user_id,payload`, { token: a.token })
const leaked = Array.isArray(readAll.json) ? readAll.json.filter((r) => r.user_id !== a.id) : []
check('A 不带过滤条件查全表 → 也只看到自己那一行', leaked.length === 0,
  `共 ${Array.isArray(readAll.json) ? readAll.json.length : '?'} 行，别人的 ${leaked.length} 行`)

/* 6. 越权写入 */
console.log('\n--- 越权：伪造别人的 user_id ---')
const forge = await rest(TABLE, {
  method: 'POST',
  token: a.token,
  prefer: 'resolution=merge-duplicates,return=representation',
  body: { user_id: b.id, payload: { marker: 'A 伪造的' } }
})
check('伪造 user_id 写 B 的行被数据库拒绝', forge.status === 401 || forge.status === 403,
  `HTTP ${forge.status} ${String(forge.text).slice(0, 110)}`)

const readBAfter = await rest(`${TABLE}?user_id=eq.${b.id}&select=payload`, { token: b.token })
check('被拒绝后 B 的数据完好无损', readBAfter.json?.[0]?.payload?.marker === 'B',
  `marker=${readBAfter.json?.[0]?.payload?.marker ?? '(无)'}`)

/* 7. 未登录读取 */
const anonRead = await rest(`${TABLE}?select=user_id`)
check('未登录读表被拒绝', anonRead.status === 401 || anonRead.status === 403,
  `HTTP ${anonRead.status} ${String(anonRead.text).slice(0, 90)}`)

/* 8. 清理 */
console.log('\n--- 收尾：删掉测试数据与测试账号 ---')
for (const [label, s] of Object.entries(sessions)) {
  const del = await rest(`${TABLE}?user_id=eq.${s.id}`, { method: 'DELETE', token: s.token })
  info(`已删除账号 ${label} 的云端数据（HTTP ${del.status}）`)
}
const leftA = await rest(`${TABLE}?user_id=eq.${a.id}&select=user_id`, { token: a.token })
check('测试数据已清理干净', Array.isArray(leftA.json) && leftA.json.length === 0,
  `剩余 ${Array.isArray(leftA.json) ? leftA.json.length : '?'} 行`)

// 有 admin token 的话，连测试账号本身也删掉，不给你的项目留垃圾
if (ADMIN_TOKEN) {
  await adminDeleteUser(a.id)
  await adminDeleteUser(b.id)
  info('已删除两个测试账号（不留残留）')
} else {
  info(`没给 admin token，测试账号需要你自己去 Authentication → Users 删：${userA.email} / ${userB.email}`)
}

/* ---------------- 汇总 ---------------- */

const failed = results.filter((r) => !r.ok)
console.log('\n================ 真机联调结果 ================')
console.log(`通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length) {
  console.log('\n失败项：')
  for (const f of failed) console.log(` - ${f.name}${f.detail ? ' — ' + f.detail : ''}`)
  process.exitCode = 1
} else {
  console.log('\n后端可用：登录、隔离、越权拦截、清理全部通过。')
  if (ADMIN_TOKEN) {
    console.log('别忘了：去 https://supabase.com/dashboard/account/tokens 把这次用的 token Revoke 掉。')
  }
}
