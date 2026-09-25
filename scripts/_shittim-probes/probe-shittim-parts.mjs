/**
 * 看清 arona 每个附件用的是图集里的哪一块，以及它在贴图上的位置。
 * 用来判断"画面被一个巨大附件占满"到底是哪个附件干的。
 *
 *   node scripts/probe-shittim-parts.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 600, height: 600 }, locale: 'zh-CN' })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}?cb=${Date.now()}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 60000 })

const out = await page.evaluate(() => {
  const st = window.__scene.stage()
  const item = st.items.get('arona')
  const { MeshAttachment, RegionAttachment } = st.core
  const sk = item.skeleton

  const parts = []
  let gMinX = Infinity
  let gMinY = Infinity
  let gMaxX = -Infinity
  let gMaxY = -Infinity

  for (const slot of sk.slots) {
    const a = slot.getAttachment()
    if (!a || !slot.bone) continue
    let box = null
    if (a instanceof MeshAttachment) {
      const wv = new Float32Array(a.worldVerticesLength)
      try {
        a.computeWorldVertices(slot, 0, a.worldVerticesLength, wv, 0, 2)
      } catch {
        continue
      }
      let mnx = Infinity
      let mny = Infinity
      let mxx = -Infinity
      let mxy = -Infinity
      for (let i = 0; i < wv.length; i += 2) {
        const x = wv[i]
        const y = wv[i + 1]
        if (!Number.isFinite(x)) continue
        if (x < mnx) mnx = x
        if (x > mxx) mxx = x
        if (y < mny) mny = y
        if (y > mxy) mxy = y
      }
      box = { minX: mnx, minY: mny, maxX: mxx, maxY: mxy }
    } else if (a instanceof RegionAttachment) {
      const s = Math.max(Math.abs(slot.bone.a), Math.abs(slot.bone.d), 1e-6)
      const hw = (Math.abs(a.width || 0) / 2) * s
      const hh = (Math.abs(a.height || 0) / 2) * s
      box = {
        minX: slot.bone.worldX - hw,
        maxX: slot.bone.worldX + hw,
        minY: slot.bone.worldY - hh,
        maxY: slot.bone.worldY + hh
      }
    }
    if (!box) continue
    gMinX = Math.min(gMinX, box.minX)
    gMaxX = Math.max(gMaxX, box.maxX)
    gMinY = Math.min(gMinY, box.minY)
    gMaxY = Math.max(gMaxY, box.maxY)

    const r = a.region
    parts.push({
      slot: slot.name,
      kind: a instanceof MeshAttachment ? 'mesh' : 'region',
      size: [Math.round(box.maxX - box.minX), Math.round(box.maxY - box.minY)],
      // 附件在图集里的像素区域（看看是不是撞上了别的东西）
      regionPx: r ? [r.x, r.y, r.width, r.height] : null,
      // 附件尺寸 ÷ 图集区域尺寸：正常应当接近 1 或 1/scale
      ratio: r && r.width ? +((box.maxX - box.minX) / r.width).toFixed(3) : null
    })
  }

  parts.sort((p, q) => q.size[0] * q.size[1] - p.size[0] * p.size[1])
  return {
    total: parts.length,
    geoBox: [Math.round(gMinX), Math.round(gMinY), Math.round(gMaxX), Math.round(gMaxY)],
    largest: parts.slice(0, 10),
    ratios: [...new Set(parts.map((p) => p.ratio).filter(Boolean))].slice(0, 10)
  }
})

console.log(JSON.stringify(out, null, 1))
await browser.close()
