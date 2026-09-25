/**
 * 判定整体几何缩放（`SkeletonBinary.scale`）该取多少 —— 用「细节量」而不是肉眼。
 *
 * 关键推理链：
 *   · 渲染结果与发行版预览图**构图、配色都一致**，但整体像被放大到 1/8 分辨率、
 *     大片色块 —— 说明贴图被**过度放大**采样（每个屏幕像素跨过很多世界单位）。
 *   · 放大倍数由「几何世界尺寸 ÷ 贴图像素」决定，而几何尺寸 ∝ `SkeletonBinary.scale`。
 *   · 所以把 scale 调小 → 单位长度的贴图像素变多 → 细节回来。
 *     scale 调过头则角色变小、但细节会更锐利；正好那一档会同时满足
 *     「色数多」+「相邻像素差大」+「构图接近参考图」。
 *
 * 量化指标：相邻像素平均差（越高越锐利）、色数（越多细节越丰富）、
 * 以及把结果和 thumb-day_1 做缩略图对比的平均差（越低越像）。
 *
 *   node scripts/probe-shittim-ksweep2.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const SRC = String.raw`D:\下载\ShittimLogon-1.4.1\ShittimLogon-1.4.1\assets`
const OUT = join(tmpdir(), 'kaoyan-ksweep2')
await mkdir(OUT, { recursive: true })

const REF = (await readFile(join(SRC, 'thumb-day_1.png'))).toString('base64')

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

const render = () =>
  page.evaluate(async () => {
    const st = window.__scene.stage()
    const { MeshAttachment } = st.core
    window.__scene.only(['office-day'])
    const item = st.items.get('office-day')
    item.state.setAnimation(0, 'Idle_00', true)
    for (let i = 0; i < 26; i++) {
      item.state.update(1 / 30)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(st.core.Physics.update)
    }
    st.resize()

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const buf = new Float32Array(8192)
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
    if (!Number.isFinite(minX)) return { error: '空' }
    const px = (maxX - minX) * 0.04
    const py = (maxY - minY) * 0.04
    st.fitTo({ minX: minX - px, maxX: maxX + px, minY: minY - py, maxY: maxY + py })

    const url = st.snapshot()
    const bin = atob(url.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = oc.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let sum = 0
    let n = 0
    const hist = new Map()
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 1; x < bmp.width; x++) {
        const i = (y * bmp.width + x) * 4
        const j = i - 4
        sum +=
          Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2])
        n++
      }
    }
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue
      const k = ((d[i] >> 5) << 10) | ((d[i + 1] >> 5) << 5) | (d[i + 2] >> 5)
      hist.set(k, (hist.get(k) || 0) + 1)
    }
    return {
      geoSize: [Math.round(maxX - minX), Math.round(maxY - minY)],
      avgEdge: +(sum / Math.max(n, 1)).toFixed(2),
      colors: hist.size,
      dataUrl: url
    }
  })

/** 与参考图做 32×18 缩略图对比 */
const diffToRef = (dataUrl) =>
  page.evaluate(
    async ({ mine, ref }) => {
      const load = (b64) =>
        new Promise((res) => {
          const im = new Image()
          im.onload = () => res(im)
          im.src = 'data:image/png;base64,' + b64
        })
      const sig = async (src) => {
        const im = await load(src)
        const c = document.createElement('canvas')
        c.width = 32
        c.height = 18
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.fillStyle = '#20303f'
        ctx.fillRect(0, 0, 32, 18)
        ctx.drawImage(im, 0, 0, 32, 18)
        return ctx.getImageData(0, 0, 32, 18).data
      }
      const a = await sig(mine.split(',')[1])
      const b = await sig(ref)
      let s = 0
      for (let i = 0; i < a.length; i += 4) {
        s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      }
      return +(s / (a.length / 4) / 3).toFixed(1)
    },
    { mine: dataUrl, ref: REF }
  )

for (const k of [0.5, 0.75, 1, 1.5, 2]) {
  await page.evaluate((kk) => window.__scene.setScale(kk), k)
  await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 30000 })
  const r = await render()
  if (r.error) {
    console.log(`k=${k}: ${r.error}`)
    continue
  }
  const diff = await diffToRef(r.dataUrl)
  await writeFile(join(OUT, `k-${k}.png`), Buffer.from(r.dataUrl.split(',')[1], 'base64'))
  // 综合评分：锐利 + 色彩丰富 + 像参考图
  console.log(
    `k=${String(k).padEnd(5)} 几何 ${r.geoSize.join('×').padEnd(11)}` +
      ` 相邻像素差 ${String(r.avgEdge).padStart(6)}` +
      ` 色数 ${String(r.colors).padStart(4)}` +
      ` 与参考图差 ${String(diff).padStart(6)}`
  )
}

console.log('\n输出目录:', OUT)
await browser.close()
