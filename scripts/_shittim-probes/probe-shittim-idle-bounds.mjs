/**
 * 量每个 Idle_XX 动画「真正会出现的内容」范围，找出该用哪一段来给登录屏取景。
 *
 *   node scripts/probe-shittim-idle-bounds.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}?cb=${Date.now()}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 60000 })

const result = await page.evaluate(() => {
  const st = window.__scene.stage()
  const item = st.items.get('office-day')
  const out = {}
  for (const a of item.data.animations) {
    if (!/^Idle_/.test(a.name)) continue
    const b = st.animationBounds('office-day', a.name, { steps: 20 })
    if (!b) continue
    out[a.name] = {
      w: Math.round(b.maxX - b.minX),
      h: Math.round(b.maxY - b.minY),
      cx: Math.round((b.minX + b.maxX) / 2),
      cy: Math.round((b.minY + b.maxY) / 2),
      box: [Math.round(b.minX), Math.round(b.minY), Math.round(b.maxX), Math.round(b.maxY)],
      duration: +a.duration.toFixed(2)
    }
  }
  return out
})

console.log('动画'.padEnd(22) + '内容宽×高'.padEnd(14) + '中心'.padEnd(16) + '包围盒')
for (const [name, b] of Object.entries(result)) {
  console.log(
    name.padEnd(22) +
      `${b.w}×${b.h}`.padEnd(14) +
      `${b.cx},${b.cy}`.padEnd(16) +
      JSON.stringify(b.box)
  )
}

await browser.close()
