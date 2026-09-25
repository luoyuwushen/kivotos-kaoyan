/**
 * 自动取景：不靠坐标推算，直接在 (zoom, 位移) 上做几轮搜索，
 * 以「不透明像素的包围盒覆盖画布的比例」为目标函数。
 *
 * 为什么值得单独写：这套素材里骨骼范围、附件范围、实际可见像素三者差得很远，
 * 任何"算出来"的机位都会偏。这里改成实测闭环：
 *   固定当前姿态 → 渲染 → 量内容包围盒 → 按误差调整 zoom 与中心 → 再测
 * 四轮之内就能把内容铺到接近满幅。
 *
 *   node scripts/probe-shittim-autofit.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-autofit')
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

/**
 * 在页面里跑闭环取景。逻辑放在页面内，避免每轮都来回通信。
 * @returns {{zoom:number, camX:number, camY:number, fill:number, bbox:object}[]} 每轮的记录
 */
const solve = (id, anim, rounds) =>
  page.evaluate(
    async ({ id, anim, rounds }) => {
      const st = window.__scene.stage()
      const canvas = st.canvas
      const gl = st.gl

      window.__scene.only([id])
      const item = st.items.get(id)
      item.state.setAnimation(0, anim, true)
      for (let i = 0; i < 24; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }

      /** 渲染一帧并量不透明像素包围盒 */
      async function measure() {
        const url = st.snapshot()
        const bin = atob(url.split(',')[1])
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const oc = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = oc.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0)
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
        let minX = bmp.width
        let minY = bmp.height
        let maxX = -1
        let maxY = -1
        let n = 0
        for (let y = 0; y < bmp.height; y++) {
          for (let x = 0; x < bmp.width; x++) {
            if (d[(y * bmp.width + x) * 4 + 3] < 8) continue
            n++
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        return n ? { minX, minY, maxX, maxY, n } : null
      }

      // 起点：把相机对准骨骼范围（不求准，只要让内容先进画面）
      st.fitTo(st.boneBounds(id))
      gl.clearColor(0, 0, 0, 0)

      const log = []
      for (let r = 0; r < rounds; r++) {
        const b = await measure()
        if (!b) {
          // 什么都看不到：缩小视野（放大 zoom）再试，最多几轮
          st.camera.zoom *= 0.6
          st.camera.update()
          log.push({ round: r, empty: true, zoom: +st.camera.zoom.toFixed(4) })
          continue
        }
        const w = b.maxX - b.minX
        const h = b.maxY - b.minY
        const fillW = w / canvas.width
        const fillH = h / canvas.height
        const fill = Math.max(fillW, fillH)
        log.push({
          round: r,
          zoom: +st.camera.zoom.toFixed(4),
          fill: +fill.toFixed(3),
          bbox: [b.minX, b.minY, b.maxX, b.maxY]
        })
        // 已经接近铺满就别动了
        if (fill > 0.86 && fill < 1.0) break

        // ① 缩放：按当前填充率反推目标 zoom
        const target = 0.82
        const factor = fill > 0.001 ? target / fill : 1.2
        const nextZoom = Math.min(Math.max(st.camera.zoom * Math.min(Math.max(factor, 0.4), 2.5), 0.001), 50)
        st.camera.zoom = nextZoom
        st.camera.update()

        // ② 平移：用「内容中心相对画布中心」的像素偏差，换算回世界坐标补上
        const cx = (b.minX + b.maxX) / 2
        const cy = (b.minY + b.maxY) / 2
        const dxPx = cx - canvas.width / 2
        const dyPx = cy - canvas.height / 2
        st.camera.position.x += dxPx / st.camera.zoom
        // 画布 y 向下、世界 y 向上，所以符号相反
        st.camera.position.y -= dyPx / st.camera.zoom
        st.camera.update()
      }

      const finalB = await measure()
      return {
        log,
        final: finalB
          ? {
              zoom: +st.camera.zoom.toFixed(4),
              camX: +st.camera.position.x.toFixed(1),
              camY: +st.camera.position.y.toFixed(1),
              fillW: +((finalB.maxX - finalB.minX) / canvas.width).toFixed(3),
              fillH: +((finalB.maxY - finalB.minY) / canvas.height).toFixed(3),
              bbox: [finalB.minX, finalB.minY, finalB.maxX, finalB.maxY]
            }
          : null
      }
    },
    { id, anim, rounds }
  )

const CASES = [
  { id: 'arona', anim: 'Idle_01' },
  { id: 'office-day', anim: 'Idle_00' },
  { id: 'office-day', anim: 'Idle_03' }
]

for (const c of CASES) {
  const r = await solve(c.id, c.anim, 6)
  console.log(`\n=== ${c.id} / ${c.anim} ===`)
  for (const l of r.log) console.log('   ', JSON.stringify(l))
  console.log('   最终:', JSON.stringify(r.final))
  const url = await page.evaluate(() => window.__scene.snapshot())
  await writeFile(
    join(OUT, `${c.id}-${c.anim}.png`),
    Buffer.from(url.split(',')[1], 'base64')
  )
}

console.log('\n输出目录:', OUT)
await browser.close()
