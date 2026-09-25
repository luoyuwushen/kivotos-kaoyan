/**
 * 找出「占满画面」的到底是哪个附件。
 *
 * 做法：用线框/逐附件的方式量，但关键是对**每个附件单独**算它的世界包围盒，
 * 并把「附件尺寸 ÷ 它用的图集区域尺寸」一起列出来。
 *   · 比例 ≈ 1      → 正常（贴图和几何一一对应）
 *   · 比例 ≫ 1      → 这个附件被拉大了，就是它占满画面
 * 同时列出图集区域在图上的位置，便于回头核对是不是取错了区域。
 *
 *   node scripts/probe-shittim-culprit.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-culprit')
await mkdir(OUT, { recursive: true })

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
  const { MeshAttachment, RegionAttachment } = st.core
  const item = st.items.get('arona')
  item.state.setAnimation(0, 'Idle_01', true)
  for (let i = 0; i < 26; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }

  const rows = []
  const buf = new Float32Array(8192)
  for (const slot of item.skeleton.slots) {
    const a = slot.getAttachment()
    if (!a || !slot.bone) continue
    const r = a.region
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let verts = 0
    let kind = 'other'

    if (a instanceof MeshAttachment) {
      kind = 'mesh'
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
        verts++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    } else if (a instanceof RegionAttachment) {
      kind = 'region'
      const o = new Float32Array(8)
      try {
        a.computeWorldVertices(slot, o, 0, 2)
      } catch {
        continue
      }
      for (let i = 0; i < 8; i += 2) {
        const x = o[i]
        const y = o[i + 1]
        if (!Number.isFinite(x)) continue
        verts++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    } else {
      continue
    }
    if (!Number.isFinite(minX)) continue

    const gw = maxX - minX
    const gh = maxY - minY
    rows.push({
      slot: slot.name,
      kind,
      verts,
      geo: [Math.round(gw), Math.round(gh)],
      // 图集区域的原始像素尺寸
      region: r ? [r.width, r.height] : null,
      // 几何 ÷ 图集区域：正常应 ≈ 1
      scaleX: r && r.width ? +(gw / r.width).toFixed(2) : null,
      scaleY: r && r.height ? +(gh / r.height).toFixed(2) : null,
      // 该附件在贴图上的位置
      regionAt: r ? [r.x, r.y] : null,
      // 面积（判断谁是"大件"）
      area: Math.round(gw * gh)
    })
  }

  rows.sort((p, q) => q.area - p.area)
  return {
    total: rows.length,
    biggest: rows.slice(0, 12),
    // 比例异常的（被拉大的）
    stretched: rows.filter((r) => (r.scaleX ?? 1) > 2 || (r.scaleY ?? 1) > 2).slice(0, 12)
  }
})

const label = (s) => String(s ?? '(无名)').slice(0, 34).padEnd(36)

console.log('=== 面积最大的 12 个附件 ===')
for (const r of out.biggest) {
  console.log(
    `  ${label(r.slot)} ${String(r.kind).padEnd(7)}` +
      ` 几何 ${String(r.geo[0]).padStart(5)}×${String(r.geo[1]).padStart(5)}` +
      ` 图集 ${String(r.region?.[0] ?? '-').padStart(5)}×${String(r.region?.[1] ?? '-').padStart(5)}` +
      ` 比例 ${r.scaleX}×${r.scaleY}`
  )
}
console.log('\n=== 被拉大（比例 > 2）的附件 ===')
if (!out.stretched.length) console.log('  （没有）')
for (const r of out.stretched) {
  console.log(
    `  ${label(r.slot)} 几何 ${r.geo.join('×')} 图集 ${r.region} 比例 ${r.scaleX}×${r.scaleY}`
  )
}
console.log('\n附件总数:', out.total)
await browser.close()
void writeFile
void OUT
