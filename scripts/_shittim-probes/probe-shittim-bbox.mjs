/**
 * 用「所有附件的世界顶点」求真实包围盒 —— 网格逐点累加，不用逐附件的 min/max。
 * 前面几版要么漏了附件、要么把 mesh 的局部顶点当世界坐标，导致包围盒偏小、
 * 机位放得过大（画面成了特写）。这里老老实实累加每个顶点。
 *
 *   node scripts/probe-shittim-bbox.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-bbox')
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

const report = await page.evaluate(async () => {
  const st = window.__scene.stage()
  const { MeshAttachment, RegionAttachment } = st.core

  /**
   * 累加式包围盒：把每个附件的每个世界顶点都并进来。
   * 这是唯一可靠的做法 —— 逐附件取 min/max 容易漏（比如 mesh 的 worldVerticesLength
   * 含义是"浮点数个数"而不是"顶点数"，用错就少算一半）。
   */
  function fullBounds(id) {
    const item = st.items.get(id)
    const sk = item.skeleton
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let counted = 0
    const buf = new Float32Array(4096)

    for (const slot of sk.slots) {
      const a = slot.getAttachment()
      if (!a || !slot.bone) continue
      if (a instanceof MeshAttachment) {
        const n = a.worldVerticesLength / 2
        const need = a.worldVerticesLength
        const wv = need <= buf.length ? buf.subarray(0, need) : new Float32Array(need)
        try {
          a.computeWorldVertices(slot, 0, need, wv, 0, 2)
        } catch {
          continue
        }
        for (let i = 0; i < n; i++) {
          const x = wv[i * 2]
          const y = wv[i * 2 + 1]
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          counted++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      } else if (a instanceof RegionAttachment) {
        const out = new Float32Array(8)
        try {
          a.computeWorldVertices(slot, out, 0, 2)
        } catch {
          continue
        }
        for (let i = 0; i < 8; i += 2) {
          const x = out[i]
          const y = out[i + 1]
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          counted++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY, counted } : null
  }

  const out = []
  const cases = [
    { id: 'arona', anim: 'Idle_01' },
    { id: 'office-day', anim: 'Idle_00' },
    { id: 'office-day', anim: 'Idle_03' }
  ]

  for (const c of cases) {
    window.__scene.only([c.id])
    const item = st.items.get(c.id)
    item.state.setAnimation(0, c.anim, true)
    for (let i = 0; i < 30; i++) {
      item.state.update(1 / 30)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(st.core.Physics.update)
    }
    st.resize()
    const box = fullBounds(c.id)
    if (!box) continue
    // 按真实包围盒取景（留 8% 边距）
    const padX = (box.maxX - box.minX) * 0.08
    const padY = (box.maxY - box.minY) * 0.08
    st.fitTo({
      minX: box.minX - padX,
      maxX: box.maxX + padX,
      minY: box.minY - padY,
      maxY: box.maxY + padY
    })

    // 量实际像素占用
    const url = st.snapshot()
    const bin = atob(url.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = oc.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let n = 0
    let pMinX = bmp.width
    let pMinY = bmp.height
    let pMaxX = -1
    let pMaxY = -1
    let hi = 0
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 0; x < bmp.width; x++) {
        const a = d[(y * bmp.width + x) * 4 + 3]
        if (a < 8) continue
        n++
        if (a > hi) hi = a
        if (x < pMinX) pMinX = x
        if (x > pMaxX) pMaxX = x
        if (y < pMinY) pMinY = y
        if (y > pMaxY) pMaxY = y
      }
    }

    // 存一张
    const name = `${c.id}-${c.anim}.png`
    out.push({
      name,
      dataUrl: url,
      verticesCounted: box.counted,
      geoBox: [Math.round(box.minX), Math.round(box.minY), Math.round(box.maxX), Math.round(box.maxY)],
      geoSize: [Math.round(box.maxX - box.minX), Math.round(box.maxY - box.minY)],
      zoom: +st.camera.zoom.toFixed(4),
      pixelBox: pMaxX < 0 ? null : [pMinX, pMinY, pMaxX, pMaxY],
      fillW: pMaxX < 0 ? 0 : +((pMaxX - pMinX) / bmp.width).toFixed(3),
      fillH: pMaxY < 0 ? 0 : +((pMaxY - pMinY) / bmp.height).toFixed(3),
      maxAlpha: hi,
      visiblePixels: n
    })
  }
  return out
})

for (const r of report) {
  const { dataUrl, ...rest } = r
  console.log(JSON.stringify(rest))
  if (dataUrl) await writeFile(join(OUT, r.name), Buffer.from(dataUrl.split(',')[1], 'base64'))
}
console.log('\n输出目录:', OUT)
await browser.close()
