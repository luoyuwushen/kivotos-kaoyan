/**
 * 直接从本机连你的 Supabase 数据库执行建表 SQL（绕开控制台 SQL Editor）。
 *
 *   node scripts/apply-schema.mjs --db-host db.xxxx.supabase.co --db-pass '你的数据库密码'
 *
 * 为什么会有这个脚本：
 *   控制台的 SQL Editor 依赖「日志服务」拉运行结果，日志服务抽风时会报
 *   `Failed to get project's logs`，让人分不清是查询失败还是面板坏了。
 *   这里直接走 Postgres 连接，结果就是我们自己执行出来的，不会再有二义性。
 *
 * 需要的东西（都在 Supabase 控制台 Project Settings → Database 里）：
 *   · Host            形如 db.xxxxxxxx.supabase.co
 *   · Database name   默认 postgres
 *   · Password        就是建项目时让你保存的那个
 *   · Port            默认 5432
 *   （若你的网络连不上 5432，改用 Connection pooling 的 6543 端口，见 README）
 *
 * 脚本可以重复执行：建表用的是 create table if not exists，
 * 策略与触发器也是先 drop 再 create。
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { splitStatements } from './lib/sql-split.mjs'

const require = createRequire(import.meta.url)

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const host = arg('db-host') || process.env.SUPABASE_DB_HOST || ''
const port = Number(arg('db-port') || process.env.SUPABASE_DB_PORT || 5432)
const dbName = arg('db-name') || process.env.SUPABASE_DB_NAME || 'postgres'
const user = arg('db-user') || process.env.SUPABASE_DB_USER || 'postgres'
const password = arg('db-pass') || process.env.SUPABASE_DB_PASSWORD || ''
const sqlFile = arg('file', 'docs/supabase-schema.sql')

if (!host || !password) {
  console.log(`
缺少参数。用法：

  node scripts/apply-schema.mjs --db-host db.xxxxxxxx.supabase.co --db-pass '你的数据库密码'

可选项：
  --db-port 5432            默认 5432（连不上就换 6543 走连接池）
  --db-name postgres        默认 postgres
  --db-user postgres        默认 postgres
  --file docs/supabase-schema.sql

这些值在 Supabase 控制台 Project Settings → Database 里。
注意密码里有特殊字符时用单引号包起来。
`)
  process.exit(1)
}

let pg
try {
  pg = require('pg')
} catch {
  console.error('缺少 pg 驱动。先跑一次：npm install pg --no-save')
  process.exit(1)
}

const sql = readFileSync(sqlFile, 'utf8')

// 把 SQL 拆成一条条执行：整段丢进去不方便定位问题，拆开的输出更清楚。
// 注意必须用认识 $$ 函数体的切分器 —— 见 scripts/lib/sql-split.mjs 里的说明。
const statements = splitStatements(sql)

console.log(`\n=== 连接 ${host}:${port}/${dbName}（user=${user}）===`)
console.log(`将执行 ${statements.length} 条语句，来自 ${sqlFile}\n`)

const client = new pg.Client({
  host,
  port,
  database: dbName,
  user,
  password,
  // Supabase 用自签证书链，这里不做 CA 校验（连接本身仍然加密）
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  statement_timeout: 30000
})

try {
  await client.connect()
  console.log('✓ 已连上数据库\n')
} catch (err) {
  console.error(`✗ 连不上：${err.message}\n`)
  console.error('排查方向：')
  console.error('  · 密码错了 / Host 抄错（Host 形如 db.xxxxxxxx.supabase.co，不要带 https://）')
  console.error('  · 5432 被网络挡了 → 换 --db-port 6543（连接池）')
  console.error('  · 项目休眠了 → 控制台点 Restore project 等一分钟')
  process.exit(1)
}

let ok = 0
let failed = 0
for (const [i, statement] of statements.entries()) {
  const label = statement.split('\n').find((l) => l.trim() && !l.trim().startsWith('--')) || statement
  try {
    const res = await client.query(statement)
    ok++
    const rows = res.rows?.length ? ` → ${JSON.stringify(res.rows[0])}` : ''
    console.log(`  ✓ [${i + 1}/${statements.length}] ${label.trim().slice(0, 68)}${rows}`)
  } catch (err) {
    failed++
    console.error(`  ✗ [${i + 1}/${statements.length}] ${label.trim().slice(0, 68)}`)
    console.error(`      ${err.message}`)
  }
}

/* ---------------- 自检：建完必须满足这几个条件 ---------------- */
console.log('\n=== 自检 ===')
try {
  const t = await client.query(
    `select c.relrowsecurity as rls, c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'kaoyan_data'`
  )
  if (!t.rows.length) {
    console.error('  ✗ kaoyan_data 表不存在 —— 建表语句没成功')
    failed++
  } else {
    console.log(`  ✓ kaoyan_data 表存在（RLS=${t.rows[0].rls}，forced=${t.rows[0].forced}）`)
    if (!t.rows[0].rls) { console.error('  ✗ 行级安全没打开！这是安全底线'); failed++ }
    if (!t.rows[0].forced) { console.error('  ✗ force row level security 没开'); failed++ }
  }

  const p = await client.query(
    `select policyname from pg_policies where schemaname='public' and tablename='kaoyan_data' order by policyname`
  )
  console.log(`  ${p.rows.length === 4 ? '✓' : '✗'} 策略 ${p.rows.length}/4 条：${p.rows.map((r) => r.policyname).join(', ')}`)
  if (p.rows.length !== 4) failed++

  const tr = await client.query(
    `select tgname from pg_trigger where tgrelid = 'public.kaoyan_data'::regclass and not tgisinternal`
  )
  console.log(`  ${tr.rows.length ? '✓' : '✗'} 自动时间戳触发器：${tr.rows.map((r) => r.tgname).join(', ') || '（缺失）'}`)
  if (!tr.rows.length) failed++
} catch (err) {
  console.error(`  ✗ 自检出错：${err.message}`)
  failed++
}

await client.end()

console.log('\n================ 结果 ================')
console.log(`执行成功 ${ok} 条，失败 ${failed ? failed + ' 项自检/语句' : '0 条'}`)
if (failed) {
  console.log('后端还不能用，先处理上面的 ✗。')
  process.exitCode = 1
} else {
  console.log('后端已就绪：表、行级安全、策略、触发器全部到位。')
  console.log('接着把 Project URL 和 anon public key 填到站点的「设置 → 云端同步」即可。')
}
