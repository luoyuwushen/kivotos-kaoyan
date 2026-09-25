/**
 * 查 UV 归一化：附件顶点的 UV 是否落在 [0,1]。
 *
 * 背景：贴图 alpha 正常（41% 是 255）、插槽色 alpha = 1，
 * 那么最终 alpha 只剩「贴图采样」这一项。若 UV 指到图集留白（alpha=0）就会近乎全透明。
 * 之前量到 mesh 的 `uvs` 最大值 1.593 —— 对 repeat:none 的图集不该超过 1.0。
 * 这里把 region 的 uv 与 attachment 的 uv 并排打出来对照，判定是不是"少除了一次页面尺寸"。
 *
 *   node scripts/probe-shittim-uvdbg.mjs
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
  const report = { atlasScale: item.atlas.scale, pages: [], attachments: [] }

  for (const pg of item.atlas.pages) {
    report.pages.push({ name: pg.name, size: [pg.width, pg.height] })
  }

  let n = 0
  for (const slot of item.skeleton.slots) {
    const a = slot.getAttachment()
    if (!a) continue
    const r = a.region
    const entry = {
      slot: slot.name,
      type: a instanceof MeshAttachment ? 'mesh' : a instanceof RegionAttachment ? 'region' : '?',
      region: r
        ? {
            name: r.name,
            // 图集 region 的归一化 UV 与像素尺寸
            u: +r.u.toFixed(4),
            v: +r.v.toFixed(4),
            u2: +r.u2.toFixed(4),
            v2: +r.v2.toFixed(4),
            size: [r.width, r.height],
            originalSize: [r.originalWidth, r.originalHeight],
            offset: [r.offsetX, r.offsetY],
            degrees: r.degrees,
            index: r.index
          }
        : null
    }
    if (a.uvs && a.uvs.length) {
      let mn = Infinity
      let mx = -Infinity
      for (const v of a.uvs) {
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      entry.uvRange = [+mn.toFixed(4), +mx.toFixed(4)]
      entry.uvFirst8 = Array.from(a.uvs).slice(0, 8).map((v) => +v.toFixed(4))
    }
    if (a.regionUVs) {
      let mn = Infinity
      let mx = -Infinity
      for (const v of a.regionUVs) {
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      entry.regionUvRange = [+mn.toFixed(4), +mx.toFixed(4)]
      entry.regionUvFirst8 = Array.from(a.regionUVs).slice(0, 8).map((v) => +v.toFixed(4))
    }
    report.attachments.push(entry)
    if (++n >= 8) break
  }
  return report
})

console.log(JSON.stringify(out, null, 1))
await browser.close()
