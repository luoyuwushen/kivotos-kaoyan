/**
 * 编码护栏：PowerShell 脚本必须带 UTF-8 BOM。
 *
 *   node scripts/check-encoding.mjs
 *
 * 为什么值得单独写个脚本看着它：
 *   Windows PowerShell 5.1 读「无 BOM 的 UTF-8」时会按系统 ANSI 代码页解析，
 *   中文全部变成乱码。这在浏览器里看不出来（网页都是 UTF-8），
 *   但在 .ps1 里会直接把引号吃掉、报一堆 "Unexpected token" ——
 *   而且**只在这台机器上复现**，CI（Linux + pwsh 7）是好的。
 *
 * 这个坑真的发生过：编辑 deploy.ps1 时编辑器写回无 BOM 版本，
 * 脚本立刻从「能用」变成「语法错误」。所以让它在提交前就失败。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = process.cwd()
const BOM = [0xef, 0xbb, 0xbf]
/** 需要检查的扩展名：这些文件会被 Windows PowerShell 直接读取 */
const EXTS = new Set(['.ps1', '.psm1', '.psd1'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name.startsWith('.')) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (EXTS.has(extname(name).toLowerCase())) out.push(full)
  }
  return out
}

const files = walk(ROOT)
const failures = []

for (const file of files) {
  const buf = readFileSync(file)
  const hasBom = buf.length >= 3 && buf[0] === BOM[0] && buf[1] === BOM[1] && buf[2] === BOM[2]
  const text = buf.toString('utf8')
  const hasCJK = /[\u4e00-\u9fff]/.test(text)
  const rel = file.slice(ROOT.length + 1)

  if (hasCJK && !hasBom) {
    failures.push(rel)
    console.log(`  ✗ ${rel}  含中文但没有 UTF-8 BOM —— Windows PowerShell 5.1 会把它读成乱码`)
  } else {
    console.log(`  ok ${rel}  ${hasCJK ? 'UTF-8 BOM' : '纯 ASCII'}`)
  }
}

console.log('\n=== 编码检查 ===')
if (failures.length) {
  console.log(`${failures.length} 个文件需要补 BOM。补法（PowerShell 一行）：`)
  console.log(`  $p='${failures[0]}'; $b=[IO.File]::ReadAllBytes($p); [IO.File]::WriteAllBytes($p, [byte[]](0xEF,0xBB,0xBF)+$b)`)
  process.exitCode = 1
} else {
  console.log(`通过：${files.length} 个 PowerShell 脚本编码都正确。`)
}
