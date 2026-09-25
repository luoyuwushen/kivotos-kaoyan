/**
 * 判断「白块」问题在数据还是渲染：
 *   ① 把附件的真实 UV 打出来（[0,1] 且互不相同 = 数据对）
 *   ② 对比 twoColorTint 开/关两种渲染器
 *
 *   node scripts/probe-shittim-uv.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-uv')
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

// ---------- ① UV 数据 ----------
console.log('=== 阿洛娜的附件 UV ===')
console.log(JSON.stringify(await page.evaluate(() => window.__scene.uvs('arona')), null, 1))

console.log('\n=== 办公室场景的附件 UV ===')
console.log(JSON.stringify(await page.evaluate(() => window.__scene.uvs('office-day')), null, 1))

// ---------- ② twoColorTint 对比 ----------
async function shot(name) {
  const url = await page.evaluate(() => window.__scene.snapshot())
  if (!url) return console.log(`${name}: 抓帧失败`)
  const buf = Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64')
  await writeFile(join(OUT, name), buf)
  const px = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const gl = c.getContext('webgl')
    const w = Math.min(c.width, 200)
    const h = Math.min(c.height, 200)
    const buf = new Uint8Array(w * h * 4)
    gl.readPixels(0, c.height - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    let white = 0
    let colored = 0
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i]
      const g = buf[i + 1]
      const b = buf[i + 2]
      if (r > 245 && g > 245 && b > 245) white++
      else if (Math.abs(r - g) + Math.abs(g - b) > 24) colored++
    }
    return { white, colored, total: w * h }
  })
  console.log(`${name.padEnd(26)} ${(buf.length / 1024).toFixed(1)}KB  白像素 ${px.white}  有色像素 ${px.colored}`)
}

for (const on of [false, true]) {
  await page.evaluate((flag) => {
    window.__scene.twoColorTint(flag)
    const st = window.__scene.stage()
    window.__scene.only(['arona'])
    window.__scene.play('arona', 'Idle_01', true)
    const item = st.items.get('arona')
    for (let i = 0; i < 30; i++) {
      item.state.update(1 / 30)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(st.core.Physics.update)
    }
    st.fitTo(st.boneBounds('arona'))
  }, on)
  await page.waitForTimeout(300)
  await shot(`twoColorTint-${on}.png`)
}

console.log('\n输出目录:', OUT)
await browser.close()
