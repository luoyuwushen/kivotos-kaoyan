/**
 * 排查「场景画不出来」：先看几何有没有送进 WebGL（调试渲染），再看贴图链路。
 *
 *   node scripts/probe-shittim-debug.mjs
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-scene')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
const page = await context.newPage()
const logs = []
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})

await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true || window.__scene?.error, { timeout: 60000 })
if (await page.evaluate(() => window.__scene.error)) {
  console.log('加载失败：', await page.evaluate(() => window.__scene.error))
  await browser.close()
  process.exit(1)
}

// 藏掉调试面板
await page.evaluate(() => {
  document.querySelectorAll('pre').forEach((n) => (n.style.display = 'none'))
  document.querySelectorAll('div').forEach((n) => {
    if (n.style && n.style.zIndex === '11') n.style.display = 'none'
  })
})
await page.waitForTimeout(300)

// 只留办公室，方便判断
await page.evaluate(() => window.__scene.only(['office-day']))

console.log('=== 1. 贴图渲染 ===')
await page.screenshot({ path: join(OUT, 'dbg-1-textured.png') })

console.log('=== 2. 调试渲染（骨骼 + 附件轮廓）===')
await page.evaluate(() => {
  window.__scene.stage().debugDraw = true
})
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'dbg-2-wireframe.png') })

console.log('=== 3. 回到贴图 + 同时看 arona ===')
await page.evaluate(() => {
  window.__scene.stage().debugDraw = false
  window.__scene.only(['office-day', 'arona'])
})
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'dbg-3-both.png') })

// 统计画布上到底有多少非背景像素 —— 用 canvas 自己读
const stats = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true })
  if (!gl) return { error: '拿不到 gl（已被其它上下文占用）' }
  const w = c.width
  const h = c.height
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  // 背景色是画布 CSS 的 #0b1a2b
  let nonBg = 0
  let opaque = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 8) opaque++
    const r = px[i]
    const g = px[i + 1]
    const b = px[i + 2]
    const a = px[i + 3]
    if (a > 8 && (Math.abs(r - 11) > 12 || Math.abs(g - 26) > 12 || Math.abs(b - 43) > 12)) nonBg++
  }
  return { w, h, opaque, nonBg, ratio: +(nonBg / (w * h)).toFixed(4) }
})
console.log('画布像素统计:', JSON.stringify(stats))

console.log('\n=== 控制台 ===')
console.log(logs.length ? logs.slice(0, 12).join('\n') : '（无）')
console.log('\n输出目录:', OUT)

await browser.close()
