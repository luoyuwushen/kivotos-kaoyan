/**
 * 用「渲染循环内抓帧」的方式实拍场景，排查「画布是空的」。
 *
 * 为什么不用 page.screenshot()：
 *   ① Playwright 对看起来没变的页面会复用上一次截图（改相机 zoom 时 DOM 不变，就会拿到旧图）；
 *   ② WebGL 的 drawingBuffer 合成后即被清空，事后 readPixels 只能拿到全 0。
 * 所以让页面自己在 draw 完那一刻 toDataURL，再把图存下来。
 *
 *   node scripts/probe-shittim-shot.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-shot')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
const page = await context.newPage()
const logs = []
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') logs.push('[error] ' + m.text())
})

await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true || window.__scene?.error, { timeout: 60000 })
if (await page.evaluate(() => window.__scene.error)) {
  console.log('加载失败：', await page.evaluate(() => window.__scene.error))
  console.log(logs.join('\n'))
  await browser.close()
  process.exit(1)
}

console.log('=== 资产体检 ===')
console.log(JSON.stringify(await page.evaluate(() => window.__scene.health()), null, 1).slice(0, 1600))

async function shot(name, mutate) {
  if (mutate) {
    await page.evaluate(mutate)
    await page.waitForTimeout(400)
  }
  const dataUrl = await page.evaluate(() => window.__scene.snapshot())
  if (!dataUrl) {
    console.log(`${name}: 抓帧失败`)
    return
  }
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  const buf = Buffer.from(b64, 'base64')
  await writeFile(join(OUT, name), buf)
  console.log(`${name}  ${(buf.length / 1024).toFixed(1)}KB`)
}

// 藏掉探针面板，免得挡住判断（抓帧只抓 canvas，其实不影响，但保持一致）
await page.evaluate(() => {
  document.querySelectorAll('pre').forEach((n) => (n.style.display = 'none'))
})

await shot('a-all-textured.png')
await shot('b-only-office.png', () => window.__scene.only(['office-day']))
await shot('c-only-arona.png', () => window.__scene.only(['arona']))
await shot('d-wireframe.png', () => {
  window.__scene.only(['office-day'])
  window.__scene.debug(true)
})
await shot('e-textured-again.png', () => window.__scene.debug(false))
await shot('f-idle.png', () => {
  window.__scene.play('office-day', 'Idle_00', true)
})

console.log('\n输出目录:', OUT)
if (logs.length) console.log('\n控制台:', logs.slice(0, 8).join('\n'))
await browser.close()
