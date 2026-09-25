/**
 * 闭环标定机位并实拍：这才是「内容有没有铺满画面」的可靠答案。
 *   node scripts/probe-shittim-solve.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-solve')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, locale: 'zh-CN' })
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
  if (!url) return
  await writeFile(join(OUT, name), Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'))
}

const CASES = [
  { id: 'arona', anim: 'Idle_01', label: '阿洛娜' },
  { id: 'office-day', anim: 'Idle_00', label: '办公室 Idle_00' },
  { id: 'office-day', anim: 'Idle_03', label: '办公室 Idle_03' }
]

for (const c of CASES) {
  await page.evaluate(
    ({ id, anim }) => {
      const st = window.__scene.stage()
      window.__scene.only([id])
      const item = st.items.get(id)
      item.state.setAnimation(0, anim, true)
      for (let i = 0; i < 30; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }
      // 先把机位粗对准骨骼范围，给闭环一个起点
      st.fitTo(st.boneBounds(id))
    },
    { id: c.id, anim: c.anim }
  )
  await page.waitForTimeout(200)

  const before = await page.evaluate(() => window.__scene.measure())
  const box = await page.evaluate(() => {
    const b = window.__scene.fitToContent(4)
    return b
  })
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => window.__scene.measure())

  console.log(`\n=== ${c.label} ===`)
  console.log('  标定前：', JSON.stringify(before))
  console.log('  标定后：', JSON.stringify(after))
  console.log(
    '  内容世界盒：',
    JSON.stringify(box, (k, v) => (typeof v === 'number' ? Math.round(v) : v))
  )
  await shot(`solve-${c.id}-${c.anim}.png`)
}

console.log('\n输出目录:', OUT)
await browser.close()
