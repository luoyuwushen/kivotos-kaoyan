/**
 * 标定：把「世界坐标 → 屏幕像素」的真实映射量出来。
 *
 * 做法（不依赖任何关于 renderer.rect 的假设）：
 *   ① 用相机自己的 worldToScreen 把某个已知世界点算成屏幕坐标；
 *   ② 渲染一帧，求不透明像素的包围盒；
 *   ③ 角色大致左右对称，用「包围盒中心」近似「该点」，两相对照就能得到误差。
 *   ④ 再换一次 zoom/position 重测，两次结果解出真实的「世界/像素」比例。
 *
 *   node scripts/probe-shittim-calib.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-calib')
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

const result = await page.evaluate(async () => {
  const st = window.__scene.stage()
  // Vector3 来自 spine-webgl（不是 spine-core），别取错模块
  const { Vector3 } = st.webgl

  window.__scene.only(['arona'])
  const item = st.items.get('arona')
  item.state.setAnimation(0, 'Idle_01', true)
  for (let i = 0; i < 30; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }

  /** 量当前帧不透明像素的包围盒 */
  async function bbox() {
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
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 0; x < bmp.width; x++) {
        if (d[(y * bmp.width + x) * 4 + 3] < 8) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    return maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
  }

  /** 相机自己的投影：世界点 → 屏幕像素 */
  function project(wx, wy) {
    const v = new Vector3(wx, wy, 0)
    st.camera.worldToScreen(v, st.canvas.width, st.canvas.height)
    return { x: +v.x.toFixed(1), y: +v.y.toFixed(1) }
  }

  const runs = []
  // 用两个不同 zoom 各测一次：分别记录「世界点→投影像素」与「实际内容包围盒」
  for (const [zoomFactor, label] of [[1, 'A'], [0.5, 'B']]) {
    const box = { minX: -514, minY: -796, maxX: 525, maxY: 1341 }
    const bw = box.maxX - box.minX
    const bh = box.maxY - box.minY
    st.camera.zoom = (Math.min(900 / bw, 900 / bh) * 0.94) * zoomFactor
    st.camera.position.x = (box.minX + box.maxX) / 2
    st.camera.position.y = (box.minY + box.maxY) / 2
    st.camera.update()

    const b = await bbox()
    runs.push({
      label,
      zoom: +st.camera.zoom.toFixed(5),
      viewport: [st.camera.viewportWidth, st.camera.viewportHeight],
      canvas: [st.canvas.width, st.canvas.height],
      // 包围盒中心投影到屏幕（这是"相机认为它会在哪"）
      centerProjected: project((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2),
      // 内容在世界里的角点投影
      topLeftProjected: project(box.minX, box.maxY),
      bottomRightProjected: project(box.maxX, box.minY),
      actualBBox: b,
      actualCenter: b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : null
    })
  }

  return { runs, worldBoxSize: [1039, 2137] }
})

console.log(JSON.stringify(result, null, 1))

// 存一张图便于肉眼确认
const url = await page.evaluate(() => window.__scene.snapshot())
await writeFile(join(OUT, 'calib.png'), Buffer.from(url.split(',')[1], 'base64'))
console.log('\n输出目录:', OUT)
await browser.close()
