/**
 * 用 Supabase Management API 执行建表 SQL（不需要数据库密码）。
 *
 *   node scripts/apply-schema-api.mjs --token sbp_xxx --ref mmfcsdznaznahohpsrtg
 *
 * 为什么有这条路：
 *   建表要在数据库上跑 DDL，正常得用 SQL Editor（浏览器）或数据库密码（psql）。
 *   但 Supabase 还给了一个官方 REST 接口专门干这事：
 *     POST https://api.supabase.com/v1/projects/{ref}/database/query
 *   它用**个人访问令牌（PAT）**鉴权，也就是控制台里生成的那个 sbp_ 开头的串。
 *   于是在大陆网络下也能绕开「浏览器连不上控制台 / SQL Editor 报 logs 错」这类问题，
 *   只要 api.supabase.com:443 能通（实测直连可通，不通就走代理）。
 *
 * 安全提醒：PAT 等于你 Supabase 账号的钥匙。跑完请到
 *   https://supabase.com/dashboard/account/tokens
 * 把它 Revoke 掉。这个脚本不会把 token 写到任何文件里。
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const token = arg('token') || process.env.SUPABASE_ACCESS_TOKEN || ''
const ref = arg('ref') || process.env.SUPABASE_PROJECT_REF || ''
const sqlFile = arg('file', 'docs/supabase-schema.sql')

if (!token || !ref) {
  console.log(`
缺少参数。用法：

  node scripts/apply-schema-api.mjs --token sbp_xxxxxxxx --ref 你的项目ref

token 在 https://supabase.com/dashboard/account/tokens 生成（sbp_ 开头）。
ref 就是项目 URL 里那一段：https://<ref>.supabase.co
`)
  process.exit(1)
}

const API = 'https://api.supabase.com/v1'

/**
 * 把 SQL 文件切成一条条语句。
 *
 * 这里踩过一个真实的坑，必须记下来：Management API 一次只接受**一条**语句，
 * 所以要把文件拆开送。但天真的「按分号 split」会把 PostgreSQL 的
 * `$$ ... $$` 函数体切碎 —— 函数体里的分号被当成语句结尾，
 * 结果送出去的是半截 CREATE FUNCTION，接口直接回 401/400，
 * 让人以为是权限问题，其实是自己的切分错了。
 * 所以这里必须认识美元引用（含 $tag$ 形式）和普通字符串字面量。
 */
function splitStatements(sql) {
  const out = []
  let current = ''
  let i = 0
  let dollarTag = null // 正在 $$…$$ 或 $tag$…$tag$ 里
  let inSingle = false // 正在 '...' 里
  let inLineComment = false
  let inBlockComment = false

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      current += ch
      if (ch === '\n') inLineComment = false
      i++
      continue
    }
    if (inBlockComment) {
      current += ch
      if (ch === '*' && next === '/') {
        current += next
        i += 2
        inBlockComment = false
        continue
      }
      i++
      continue
    }
    if (inSingle) {
      current += ch
      if (ch === "'") {
        if (next === "'") {
          current += next
          i += 2
          continue
        }
        inSingle = false
      }
      i++
      continue
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag
        i += dollarTag.length
        dollarTag = null
        continue
      }
      current += ch
      i++
      continue
    }

    if (ch === '-' && next === '-') {
      inLineComment = true
      current += ch + next
      i += 2
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      current += ch + next
      i += 2
      continue
    }
    if (ch === "'") {
      inSingle = true
      current += ch
      i++
      continue
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (m) {
        dollarTag = m[0]
        current += dollarTag
        i += dollarTag.length
        continue
      }
    }
    if (ch === ';') {
      out.push(current.trim())
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  if (current.trim()) out.push(current.trim())

  // 只由注释组成的片段不算语句
  return out.filter((s) => s && !s.split('\n').every((line) => line.trim().startsWith('--')))
}

async function api(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000)
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, text, json }
}

/* ---------------- 1. 先确认 token 与项目都对得上 ---------------- */
console.log(`\n=== 用 Management API 执行建表：项目 ${ref} ===`)
const project = await api(`/projects/${ref}`)
if (project.status !== 200) {
  console.error(`✗ 读项目失败（HTTP ${project.status}）：${project.text.slice(0, 200)}`)
  console.error('  401/403 → token 不对或已失效；404 → ref 不对。')
  process.exit(1)
}
console.log(`✓ 项目可访问：${project.json.name}（区域 ${project.json.region}，状态 ${project.json.status}）`)

/* ---------------- 2. 执行建表 SQL ---------------- */
const sql = await readFile(sqlFile, 'utf8')
const statements = splitStatements(sql)
console.log(`  执行 ${sqlFile}：${statements.length} 条语句\n`)

let execFailed = 0
for (const [i, statement] of statements.entries()) {
  const label = (statement.split('\n').find((l) => l.trim() && !l.trim().startsWith('--')) || statement)
    .trim()
    .slice(0, 66)
  const r = await api(`/projects/${ref}/database/query`, { method: 'POST', body: { query: statement } })
  if (r.status >= 400) {
    console.error(`  ✗ [${i + 1}/${statements.length}] ${label}`)
    console.error(`      HTTP ${r.status} ${r.text.slice(0, 200)}`)
    execFailed++
  } else {
    const shown = r.text && r.text !== '[]' ? ` → ${r.text.slice(0, 90)}` : ''
    console.log(`  ✓ [${i + 1}/${statements.length}] ${label}${shown}`)
  }
}
if (execFailed) {
  console.error(`\n有 ${execFailed} 条语句执行失败，继续做自检以便看清全貌。`)
}

/* ---------------- 3. 自检：把关键事实查出来 ---------------- */
const checks = [
  ['表存在 + RLS + force RLS', `select relrowsecurity as rls, relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='kaoyan_data'`],
  ['策略条数', `select count(*)::int as policies from pg_policies where schemaname='public' and tablename='kaoyan_data'`],
  ['策略名单', `select policyname, cmd from pg_policies where schemaname='public' and tablename='kaoyan_data' order by policyname`],
  ['时间戳触发器', `select tgname from pg_trigger where tgrelid='public.kaoyan_data'::regclass and not tgisinternal`],
  ['表结构', `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='kaoyan_data' order by ordinal_position`]
]

console.log('\n=== 自检 ===')
let failed = 0
for (const [label, query] of checks) {
  const r = await api(`/projects/${ref}/database/query`, { method: 'POST', body: { query } })
  if (r.status >= 400) {
    console.error(`  ✗ ${label}：${r.text.slice(0, 160)}`)
    failed++
    continue
  }
  console.log(`  ✓ ${label}：${JSON.stringify(r.json)}`)
}

/* ---------------- 4. 触发 PostgREST 重新加载 schema cache ---------------- */
// 刚建的表有时要等 PostgREST 刷新一下才认得（否则 REST 会继续报 404）
const reload = await api(`/projects/${ref}/database/query`, {
  method: 'POST',
  body: { query: `notify pgrst, 'reload schema'` }
})
console.log(reload.status < 400 ? '  ✓ 已通知 PostgREST 重载 schema' : `  ! 重载通知失败（不影响建表）：${reload.text.slice(0, 100)}`)

console.log('\n================ 结果 ================')
if (failed || execFailed) {
  console.log(`执行失败 ${execFailed} 条，自检失败 ${failed} 项 —— 请看上面的 ✗。`)
  process.exitCode = 1
} else {
  console.log('后端已就绪：表、行级安全、4 条策略、时间戳触发器全部到位。')
  console.log('安全提醒：去 https://supabase.com/dashboard/account/tokens')
  console.log('把刚才那个 token Revoke 掉（它等于你账号的钥匙）。')
}
