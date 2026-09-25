/**
 * 复现「渲染出纯白」并定位是哪个环节断的。
 *
 * 已知：无论相机怎么设，抓到的帧都是 129600 个 (255,255,255) 不透明像素。
 * 而 probe-shittim-compare.mjs 用同样的姿势却能画出教室。
 * 差别在于「调用顺序」：compare 里是 fitTo(...) 之后立刻 snapshot；
 * 这里是 setScale 换过 stage、或者先只设 camera 再 snapshot。
 *
 * 所以这里一步步来，每步都抓帧 + 数绘制调用，找出第一次变白的位置。
 *
 *   node scripts/probe-shittim-white.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-white')
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

const stats = () =>
  page.evaluate(async () => {
    const st = window.__scene.stage()
    const url = st.snapshot()
    const bin = atob(url.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = oc.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const hist = new Map()
    let opaque = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue
      opaque++
      const k = ((d[i] >> 5) << 10) | ((d[i + 1] >> 5) << 5) | (d[i + 2] >> 5)
      hist.set(k, (hist.get(k) || 0) + 1)
    }
    return { opaque, colors: hist.size, dataUrl: url }
  })

const step = async (label, fn) => {
  if (fn) await page.evaluate(fn)
  const s = await stats()
  const counts = await page.evaluate(() => window.__scene.countFrame())
  console.log(
    `${label.padEnd(34)} 不透明 ${String(s.opaque).padStart(6)}  色数 ${String(s.colors).padStart(4)}` +
      `  drawElements ${counts.drawElements}  索引 ${counts.indices}`
  )
  await writeFile(
    join(OUT, `${label.replace(/[^\w]+/g, '_')}.png`),
    Buffer.from(s.dataUrl.split(',')[1], 'base64')
  )
  return s
}

// ① 刚加载完，什么都不动
await step('1 刚加载')

// ② 只播动画
await step('2 播 Idle_00', () => {
  const st = window.__scene.stage()
  const item = st.items.get('office-day')
  item.state.setAnimation(0, 'Idle_00', true)
  for (let i = 0; i < 26; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
})

// ③ 只显示 office-day
await step('3 only(office-day)', () => {
  window.__scene.only(['office-day'])
})

// ④ 只 resize
await step('4 resize()', () => {
  window.__scene.stage().resize()
})

// ⑤ 相机设成"看得到东西"的样子（用附件包围盒中心 + 小 zoom）
await step('5 设相机(小zoom)', () => {
  const st = window.__scene.stage()
  st.camera.zoom = 0.06
  st.camera.position.x = 0
  st.camera.position.y = 1900
  st.camera.update()
})

// ⑥ 用官方 fitTo（compare 脚本用的就是它）
await step('6 用 fitTo(附件盒)', () => {
  const st = window.__scene.stage()
  const { MeshAttachment } = st.core
  const item = st.items.get('office-day')
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const buf = new Float32Array(16384)
  for (const slot of item.skeleton.slots) {
    const a = slot.getAttachment()
    if (!(a instanceof MeshAttachment) || !slot.bone) continue
    const need = a.worldVerticesLength
    const wv = need <= buf.length ? buf.subarray(0, need) : new Float32Array(need)
    try {
      a.computeWorldVertices(slot, 0, need, wv, 0, 2)
    } catch {
      continue
    }
    for (let i = 0; i < need; i += 2) {
      const x = wv[i]
      const y = wv[i + 1]
      if (!Number.isFinite(x)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  st.fitTo({ minX, minY, maxX, maxY })
  return { minX, minY, maxX, maxY }
})

console.log('\n输出目录:', OUT)
await browser.close()
