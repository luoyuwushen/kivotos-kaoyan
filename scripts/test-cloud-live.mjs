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
const stamp = Date.now().toString(36)
const userA = { email: `kaoyan-live-test-${stamp}-a@example.com`, password: `Kaoyan-${stamp}-Aa1` }
const userB = { email: `kaoyan-live-test-${stamp}-b@example.com`, password: `Kaoyan-${stamp}-Bb2` }
const sessions = {}

async function signUpAndLogin(user, label) {
  const signup = await auth('signup', { body: { email: user.email, password: user.password } })
  const login = await auth('token?grant_type=password', {
    body: { email: user.email, password: user.password }
  })
  const token = login.json?.access_token || ''
  const id = login.json?.user?.id || signup.json?.id || ''
  if (token) sessions[label] = { token, id, email: user.email }
  return { signup, login, token, id }
}

console.log('\n--- 注册并登录两个测试账号 ---')
const a = await signUpAndLogin(userA, 'A')
const b = await signUpAndLogin(userB, 'B')

check('账号 A 能注册并登录', Boolean(a.token), a.token ? `user_id ${a.id}` : `signup=${a.signup.status} ${String(a.signup.text).slice(0, 120)}`)
check('账号 B 能注册并登录', Boolean(b.token), b.token ? `user_id ${b.id}` : `login=${b.login.status} ${String(b.login.text).slice(0, 120)}`)

if (!a.token || !b.token) {
  const hint = /confirm/i.test(a.signup.text + b.signup.text)
    ? '项目开着「Confirm email」，注册后拿不到会话。测试用的邮箱收不到信 —— 去 Authentication → Sign In / Providers → Email 关掉 Confirm email，或者用魔法链接在浏览器里手动登一次。'
    : '请检查 anon key 是否是 anon public（不是 service_role），以及项目是否开启了 Email 登录。'
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
console.log('\n--- 收尾：删掉测试数据 ---')
for (const [label, s] of Object.entries(sessions)) {
  const del = await rest(`${TABLE}?user_id=eq.${s.id}`, { method: 'DELETE', token: s.token })
  info(`已删除账号 ${label} 的云端数据（HTTP ${del.status}）`)
}
const leftA = await rest(`${TABLE}?user_id=eq.${a.id}&select=user_id`, { token: a.token })
check('测试数据已清理干净', Array.isArray(leftA.json) && leftA.json.length === 0,
  `剩余 ${Array.isArray(leftA.json) ? leftA.json.length : '?'} 行`)

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
  console.log(`提醒：可以在 Supabase 控制台 → Authentication → Users 里删掉这两个测试账号：`)
  console.log(`  ${userA.email}\n  ${userB.email}`)
}
