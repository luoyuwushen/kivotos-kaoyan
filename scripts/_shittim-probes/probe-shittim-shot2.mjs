/**
 * 按「附件真实包围盒」取景并实拍。这一版把机位用确定的算式给出，
 * 不再搜索：zoom = min(vw/(w·(1+2·pad)), vh/(h·(1+2·pad)))，中心对准包围盒中心。
 *
 *   node scripts/probe-shittim-shot2.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-shot2')
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

const result = await page.evaluate(() => {
  const st = window.__scene.stage()
  const { RegionAttachment, MeshAttachment } = st.core

  /** 用附件真实世界顶点算包围盒（mesh 走 computeWorldVertices，权威） */
  function attachmentBounds(id) {
    const item = st.items.get(id)
    const sk = item.skeleton
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const slot of sk.slots) {
      const a = slot.getAttachment()
      if (!a || !slot.bone) continue
      if (a instanceof MeshAttachment) {
        const n = a.worldVerticesLength / 2
        const wv = new Float32Array(a.worldVerticesLength)
        try {
          a.computeWorldVertices(slot, 0, a.worldVerticesLength, wv, 0, 2)
        } catch {
          continue
        }
        for (let i = 0; i < n; i++) {
          const x = wv[i * 2]
          const y = wv[i * 2 + 1]
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      } else if (a instanceof RegionAttachment) {
        const s = Math.max(Math.abs(slot.bone.a), Math.abs(slot.bone.d), 1e-6)
        const hw = (Math.abs(a.width || 0) / 2) * s
        const hh = (Math.abs(a.height || 0) / 2) * s
        minX = Math.min(minX, slot.bone.worldX - hw)
        maxX = Math.max(maxX, slot.bone.worldX + hw)
        minY = Math.min(minY, slot.bone.worldY - hh)
        maxY = Math.max(maxY, slot.bone.worldY + hh)
      }
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
  }

  const out = []
  const cases = [
    { ids: ['arona'], anims: { arona: 'Idle_01' } },
    { ids: ['office-day'], anims: { 'office-day': 'Idle_00' } },
    { ids: ['office-day'], anims: { 'office-day': 'Idle_03' } }
  ]

  for (const c of cases) {
    window.__scene.only(c.ids)
    for (const [id, anim] of Object.entries(c.anims)) {
      const item = st.items.get(id)
      item.state.setAnimation(0, anim, true)
      for (let i = 0; i < 24; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }
    }
    // 合并所有显示中的骨架
    let box = null
    for (const id of c.ids) {
      const b = attachmentBounds(id)
      if (!b) continue
      box = box
        ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
        : { ...b }
    }
    if (!box) continue
    st.fitTo(box)
    const cam = st.viewportRect()
    out.push({
      ids: c.ids.join('+'),
      anim: Object.values(c.anims)[0],
      box: [Math.round(box.minX), Math.round(box.minY), Math.round(box.maxX), Math.round(box.maxY)],
      zoom: +st.camera.zoom.toFixed(4),
      camPos: [+st.camera.position.x.toFixed(1), +st.camera.position.y.toFixed(1)],
      visible: [Math.round(cam.right - cam.left), Math.round(cam.top - cam.bottom)],
      // 内容相对画布的可见比例（按世界尺寸算，理论值）
      fillTheory: +(Math.min((box.maxX - box.minX) / (cam.right - cam.left), (box.maxY - box.minY) / (cam.top - cam.bottom))).toFixed(3)
    })
  }
  return out
})

for (const r of result) {
  console.log(JSON.stringify(r))
}
await page.waitForTimeout(400)
const url = await page.evaluate(() => window.__scene.snapshot())
await writeFile(join(OUT, 'last.png'), Buffer.from(url.split(',')[1], 'base64'))
console.log('\n最后一张已存: last.png ->', OUT)
await browser.close()
