/**
 * 全面体检：把所有图集 region 的 UV 都查一遍，看还有多少越界；
 * 顺便看每个 region 对应的贴图像素到底是不是透明的。
 *
 *   node scripts/probe-shittim-regions.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 400, height: 400 }, locale: 'zh-CN' })
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
  const res = {}

  for (const [id, item] of st.items) {
    const atlas = item.atlas
    const bad = []
    let maxU2 = 0
    let maxV2 = 0
    for (const r of atlas.regions) {
      if (r.u2 > maxU2) maxU2 = r.u2
      if (r.v2 > maxV2) maxV2 = r.v2
      if (r.u < 0 || r.v < 0 || r.u2 > 1.0001 || r.v2 > 1.0001) {
        if (bad.length < 6) {
          bad.push({
            name: r.name,
            uv: [+r.u.toFixed(4), +r.v.toFixed(4), +r.u2.toFixed(4), +r.v2.toFixed(4)],
            xywh: [r.x, r.y, r.width, r.height],
            page: [r.page.width, r.page.height]
          })
        }
      }
    }
    res[id] = {
      atlasScale: atlas.scale,
      regions: atlas.regions.length,
      pages: atlas.pages.map((pg) => ({ name: pg.name, size: [pg.width, pg.height] })),
      maxU2: +maxU2.toFixed(4),
      maxV2: +maxV2.toFixed(4),
      outOfRangeCount: atlas.regions.filter((r) => r.u2 > 1.0001 || r.v2 > 1.0001 || r.u < 0 || r.v < 0).length,
      sample: bad
    }
  }
  return res
})

console.log(JSON.stringify(out, null, 1))
await browser.close()
