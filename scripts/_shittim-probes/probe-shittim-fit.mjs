/**
 * 按「动画实际内容范围」取景并实拍，确认角色终于出现在画面里。
 *   node scripts/probe-shittim-fit.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-fit')
await mkdir(OUT, { recursive: true })

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
await page.evaluate(() => {
  document.querySelectorAll('pre').forEach((n) => (n.style.display = 'none'))
})

async function shot(name) {
  const url = await page.evaluate(() => window.__scene.snapshot())
  if (!url) return console.log(`${name}: 抓帧失败`)
  const buf = Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64')
  await writeFile(join(OUT, name), buf)
  console.log(`${name.padEnd(26)} ${(buf.length / 1024).toFixed(1)}KB`)
}

for (const anim of ['Idle_00', 'Idle_01', 'Idle_02', 'Idle_03', 'Idle_11', 'Idle_12']) {
  const box = await page.evaluate((a) => {
    const st = window.__scene.stage()
    const b = st.animationBounds('office-day', a, { steps: 20 })
    if (b) st.fitTo(b)
    return b
  }, anim)
  await page.waitForTimeout(300)
  console.log(
    `\n${anim}  内容盒 ${JSON.stringify(box, (k, v) => (typeof v === 'number' ? Math.round(v) : v))}`
  )
  // 播这段动画并推进一点，让附件挂上
  await page.evaluate((a) => {
    const st = window.__scene.stage()
    const item = st.items.get('office-day')
    item.state.setAnimation(0, a, true)
    for (let i = 0; i < 20; i++) {
      item.state.update(1 / 30)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(st.core.Physics.update)
    }
  }, anim)
  await shot(`fit-${anim}.png`)
}

console.log('\n输出目录:', OUT)
await browser.close()
