/**
 * 判定 atlas.scale 该怎么设。
 *
 * 已经把搬运做对了（bounds 随贴图一起缩，region UV 落在 [0,1]），
 * 剩下的问题只有一个：`atlas.scale`（1.24 / 1.3 / 1.12）要不要让运行时生效。
 * 它作用在附件的**几何尺寸**上，不影响 UV。设错会让画面整体放大/缩小一圈。
 *
 *   node scripts/probe-shittim-scale3.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-scale3')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 800, height: 800 }, locale: 'zh-CN' })
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

/** 用「附件几何包围盒 ÷ 画布可见范围」算出内容占画面的比例，判断有没有被放大过头 */
const run = (scaleValue) =>
  page.evaluate(async (sv) => {
    const st = window.__scene.stage()
    const { MeshAttachment, RegionAttachment } = st.core
    window.__scene.only(['arona'])
    const item = st.items.get('arona')

    // 设置 scale，并重算所有附件的 region / UV
    item.atlas.scale = sv
    for (const slot of item.skeleton.slots) {
      const a = slot.getAttachment()
      if (!a) continue
      if (a instanceof RegionAttachment || a instanceof MeshAttachment) {
        a.updateRegion?.()
        a.updateUVs?.()
      }
    }
    item.state.setAnimation(0, 'Idle_01', true)
    for (let i = 0; i < 30; i++) {
      item.state.update(1 / 30)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(st.core.Physics.update)
    }

    // 附件几何范围
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const slot of item.skeleton.slots) {
      const a = slot.getAttachment()
      if (!a || !slot.bone) continue
      if (a instanceof MeshAttachment) {
        const wv = new Float32Array(a.worldVerticesLength)
        try {
          a.computeWorldVertices(slot, 0, a.worldVerticesLength, wv, 0, 2)
        } catch {
          continue
        }
        for (let i = 0; i < wv.length; i += 2) {
          const x = wv[i]
          const y = wv[i + 1]
          if (!Number.isFinite(x)) continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (!Number.isFinite(minX)) return null
    st.fitTo({ minX, minY, maxX, maxY })

    // 渲染并量实际像素占用（这才是"看起来多大"）
    const url = st.snapshot()
    const bin = atob(url.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = oc.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let pMinX = bmp.width
    let pMinY = bmp.height
    let pMaxX = -1
    let pMaxY = -1
    let n = 0
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
    return {
      scale: sv,
      geoBox: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)],
      pixelBox: pMaxX < 0 ? null : [pMinX, pMinY, pMaxX, pMaxY],
      fillW: pMaxX < 0 ? 0 : +((pMaxX - pMinX) / bmp.width).toFixed(3),
      fillH: pMaxY < 0 ? 0 : +((pMaxY - pMinY) / bmp.height).toFixed(3),
      maxAlpha: hi,
      visible: n
    }
  }, scaleValue)

for (const sv of [1, 1.3]) {
  const r = await run(sv)
  console.log(`atlas.scale = ${sv}:`, JSON.stringify(r))
  const url = await page.evaluate(() => window.__scene.snapshot())
  await writeFile(join(OUT, `scale-${sv}.png`), Buffer.from(url.split(',')[1], 'base64'))
}

console.log('\n输出目录:', OUT)
await browser.close()
