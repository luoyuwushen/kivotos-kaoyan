/**
 * 配置 Supabase 项目（一次性）。
 *
 *   npm run supabase:setup
 *
 * 它会：
 *   1. 问你要 Supabase 项目的 URL 和 anon public key（或从命令行参数读）
 *   2. 校验格式（顺手拦掉 service_role / secret key 这种不能放前端的）
 *   3. 写成项目根目录的 .env.local（已在 .gitignore 里，不会被提交）
 *   4. 立刻跑一次真机联调，确认建表 SQL 执行过、RLS 生效、登录与隔离都对
 *
 * 为什么不把这两个值硬编码进源码：
 *   anon key 本身是公开的，但把「这个站用哪个后端」写成构建期常量，
 *   会让「别人 fork 一份自己部署」变成必须改代码。放 .env.local 里，
 *   本地构建带上、GitHub Pages 构建不带（使用者自己在设置页填），两边都对。
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { spawnSync } from 'node:child_process'

const ENV_FILE = '.env.local'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : ''
}

function validate(url, anon) {
  const u = String(url || '').trim().replace(/\/+$/, '')
  const k = String(anon || '').trim()
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(u)) {
    return { ok: false, message: 'Project URL 形如 https://abcdefgh.supabase.co（不要带结尾斜杠或 /rest/v1）' }
  }
  if (!k || k.length < 40) return { ok: false, message: 'anon public key 看起来不完整' }
  if (/^sb_secret_|service_role/i.test(k)) {
    return { ok: false, message: '这是 service_role / secret key，绝不能放在前端。请用 anon public key。' }
  }
  return { ok: true, message: '' }
}

console.log(`
============================================================
  配置 Supabase 后端
============================================================
  在哪找这两项：Supabase 控制台 → Project Settings → API
    · Project URL        →  https://xxxxxxxx.supabase.co
    · Project API keys   →  anon / public 那一行（不是 service_role）

  还没建项目？先看 README 的「用 Supabase 做真正的后端」一节，
  建完项目记得在 SQL Editor 里执行 docs/supabase-schema.sql，
  否则登录后会提示「还没有 kaoyan_data 表」。
`)

let url = arg('url')
let anon = arg('anon')

if (!url || !anon) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  if (!url) url = (await rl.question('Project URL       : ')).trim()
  if (!anon) anon = (await rl.question('anon public key   : ')).trim()
  rl.close()
}

const check = validate(url, anon)
if (!check.ok) {
  console.error(`\n✗ ${check.message}\n`)
  process.exit(1)
}

const finalUrl = url.trim().replace(/\/+$/, '')
const finalAnon = anon.trim()

/* 写 .env.local：保留原有其他变量，只覆盖这两项 */
const keep = existsSync(ENV_FILE)
  ? readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() && !/^\s*VITE_SUPABASE_(URL|ANON_KEY)\s*=/.test(line))
  : []
const content = [
  '# Supabase 后端配置（本文件不进版本库）',
  '# anon key 是公开信息，真正的安全边界是数据库的 RLS 策略',
  `VITE_SUPABASE_URL=${finalUrl}`,
  `VITE_SUPABASE_ANON_KEY=${finalAnon}`,
  ...keep,
  ''
].join('\n')

writeFileSync(ENV_FILE, content, 'utf8')
console.log(`\n✓ 已写入 ${ENV_FILE}`)
console.log('  （本地构建与 npm run dev 会自动读取；GitHub Pages 的构建读不到，' +
  '使用者会回到「设置 → 云端同步」自己填，这是有意的。）')

console.log('\n接着跑一次真机联调……\n')
const run = spawnSync(
  process.execPath,
  ['scripts/test-cloud-live.mjs', '--url', finalUrl, '--anon', finalAnon],
  { stdio: 'inherit' }
)
process.exit(run.status ?? 0)
