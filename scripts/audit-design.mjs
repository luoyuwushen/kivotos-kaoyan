/**
 * DESIGN.md 合规检查（不参与部署，本地/CI 用）。
 *
 * 守两条最容易随时间腐化的红线：
 *   1) 样式表里不准出现硬编码颜色 —— 所有颜色必须走 CSS 变量。
 *      例外：:root 的 token 定义块本身，以及 data:image/svg+xml 里的勾选图标。
 *   2) 字号必须落在 DESIGN.md 第 3 节的层级表里 —— 防止随手加第 9 种字号。
 *
 *   node scripts/audit-design.mjs
 */
import { readFileSync } from 'node:fs'

const CSS = 'src/styles/main.css'
const css = readFileSync(CSS, 'utf8')
const lines = css.split('\n')

let failures = 0
const fail = (line, message) => {
  failures++
  console.log(`  ✗ ${CSS}:${line}  ${message}`)
}

/* ---------- 1. 硬编码颜色 ---------- */

// :root 与 :root[data-theme='dark'] 里的 token 定义是唯一允许写 hex 的地方
const tokenRanges = []
let depth = 0
let tokenStart = -1
lines.forEach((line, i) => {
  const isTokenBlockOpen = /^:root\b.*\{/.test(line.trim())
  if (isTokenBlockOpen) {
    tokenStart = i
    depth = 0
  }
  if (tokenStart >= 0) {
    depth += (line.match(/\{/g) || []).length
    depth -= (line.match(/\}/g) || []).length
    if (depth <= 0 && i > tokenStart) {
      tokenRanges.push([tokenStart, i])
      tokenStart = -1
    }
  }
})
const inTokenBlock = (i) => tokenRanges.some(([a, b]) => i >= a && i <= b)

const HEX = /#[0-9a-fA-F]{3,8}\b/g
const RGB_FN = /\brgba?\(\s*\d/g
let hexCount = 0
let rgbCount = 0

lines.forEach((line, i) => {
  if (i === 0) return
  const trimmed = line.trim()
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return

  // data:image/svg+xml 里的颜色是内联图标，没法用变量，放行
  const withoutDataUri = line.replace(/data:image\/svg\+xml[^")]*/g, '')

  if (inTokenBlock(i)) return

  const hexes = withoutDataUri.match(HEX)
  if (hexes) {
    hexCount += hexes.length
    fail(i + 1, `硬编码 hex：${hexes.join(', ')}`)
  }
  if (RGB_FN.test(withoutDataUri)) {
    rgbCount++
    fail(i + 1, `硬编码 rgb()/rgba() 数值：${trimmed.slice(0, 70)}`)
  }
})

/* ---------- 2. 字号层级 ---------- */

// DESIGN.md 第 3 节定义的层级 + 允许的零碎尺寸（图标、徽标等）
const ALLOWED_PX = new Set([
  10, 11, 12, 13, 14, 15, 16, 17, 20, 24, 28, 32, 36, 40, 56, 64, 72, 168
])
const fontSizes = new Set()
const FS = /font-size:\s*([^;]+);/g
let m
while ((m = FS.exec(css))) {
  const value = m[1].trim()
  const px = /^([\d.]+)px$/.exec(value)
  if (px) fontSizes.add(Number(px[1]))
}
const oddSizes = [...fontSizes].filter((v) => !ALLOWED_PX.has(v)).sort((a, b) => a - b)

/* ---------- 输出 ---------- */

console.log('\n=== DESIGN.md 合规检查 ===')
console.log(`样式表：${lines.length} 行 / ${(css.length / 1024).toFixed(1)} KB`)
console.log(`token 定义块：${tokenRanges.length} 处（允许写 hex）`)
console.log(`token 块外的硬编码颜色：hex ${hexCount} 处，rgb() ${rgbCount} 处`)
console.log(`字号种类：${[...fontSizes].sort((a, b) => a - b).join(', ')}`)
if (oddSizes.length) {
  console.log(`  ! 层级外的字号（请确认是有意为之，否则收进 token）：${oddSizes.join(', ')}px`)
}

if (failures) {
  console.log(`\n${failures} 处违规。`)
  process.exitCode = 1
} else {
  console.log('\n通过：组件里没有硬编码配色，全部走 CSS 变量。')
}
