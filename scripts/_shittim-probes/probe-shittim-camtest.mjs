/**
 * 直接验证：改相机参数之后，渲染结果到底变不变？
 *
 * 上一轮用「与参考图差异」做坐标下降时，差异恒为 80.12、一轮都没改善。
 * 这有两种可能：
 *   ① 相机参数确实没进到绘制里（链路问题）
 *   ② 我的差异计算写错了（纯白底 → 差异恒定）
 * 这个脚本把两者分开：连设两个差别极大的机位各渲一张，
 * 比较 dataURL 长度与像素统计。图不同 → 链路没问题，问题在差异计算；
 * 图完全相同 → 相机参数真的没生效。
 *
 *   node scripts/probe-shittim-camtest.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-camtest')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 480, height: 270 }, locale: 'zh-CN' })
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

// 准备：office-day / Idle_00
await page.evaluate(() => {
  const st = window.__scene.stage()
  window.__scene.only(['office-day'])
  const item = st.items.get('office-day')
  item.state.setAnimation(0, 'Idle_00', true)
  for (let i = 0; i < 26; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  st.resize()
})

const shot = (camX, camY, zoom) =>
  page.evaluate(
    async ({ camX, camY, zoom }) => {
      const st = window.__scene.stage()
      st.resize()
      st.camera.zoom = zoom
      st.camera.position.x = camX
      st.camera.position.y = camY
      st.camera.update()
      const camAfter = {
        zoom: +st.camera.zoom.toFixed(6),
        pos: [+st.camera.position.x.toFixed(1), +st.camera.position.y.toFixed(1)]
      }
      const url = st.snapshot()
      // 看一下 snapshot 之后相机有没有被改回去
      const camPost = {
        zoom: +st.camera.zoom.toFixed(6),
        pos: [+st.camera.position.x.toFixed(1), +st.camera.position.y.toFixed(1)]
      }
      // 像素统计（不经过任何中间 canvas，直接在页面里解）
      const bin = atob(url.split(',')[1])
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const oc = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = oc.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0)
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      let opaque = 0
      let sumR = 0
      let sumG = 0
      let sumB = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8) {
          opaque++
          sumR += d[i]
          sumG += d[i + 1]
          sumB += d[i + 2]
        }
      }
      return {
        camAfter,
        camPost,
        dataUrlLen: url.length,
        opaque,
        avg: opaque
          ? [Math.round(sumR / opaque), Math.round(sumG / opaque), Math.round(sumB / opaque)]
          : null,
        dataUrl: url
      }
    },
    { camX, camY, zoom }
  )

const A = await shot(-8, 1919, 0.0605)
const B = await shot(-8, 1919, 0.02)
const C = await shot(1500, 500, 0.0605)

for (const [name, r] of [['A 默认', A], ['B 缩小3倍', B], ['C 平移', C]]) {
  console.log(
    `${name.padEnd(12)} 设置后 zoom=${r.camAfter.zoom} pos=${r.camAfter.pos.join(',')}` +
      `  | 抓帧后 zoom=${r.camPost.zoom} pos=${r.camPost.pos.join(',')}` +
      `  | dataURL ${r.dataUrlLen}B 不透明 ${r.opaque} 均色 ${r.avg}`
  )
}

console.log('\nA 与 B 的 dataURL 是否相同:', A.dataUrl === B.dataUrl)
console.log('A 与 C 的 dataURL 是否相同:', A.dataUrl === C.dataUrl)

await writeFile(join(OUT, 'A.png'), Buffer.from(A.dataUrl.split(',')[1], 'base64'))
await writeFile(join(OUT, 'B.png'), Buffer.from(B.dataUrl.split(',')[1], 'base64'))
await writeFile(join(OUT, 'C.png'), Buffer.from(C.dataUrl.split(',')[1], 'base64'))
console.log('输出目录:', OUT)
await browser.close()
