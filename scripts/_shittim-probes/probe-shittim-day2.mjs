/**
 * office-day 为什么一个像素都不画：查骨架变换、根骨骼、附件顶点的有效性。
 *   node scripts/probe-shittim-day2.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'

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

const out = await page.evaluate(() => {
  const st = window.__scene.stage()
  const item = st.items.get('office-day')
  const sk = item.skeleton
  const { MeshAttachment, RegionAttachment } = st.core

  item.state.setAnimation(0, 'Idle_00', true)
  for (let i = 0; i < 30; i++) {
    item.state.update(1 / 30)
    item.state.apply(sk)
    sk.updateWorldTransform(st.core.Physics.update)
  }

  const report = {
    skeleton: {
      x: sk.x,
      y: sk.y,
      scaleX: sk.scaleX,
      scaleY: sk.scaleY,
      time: +sk.time.toFixed(2),
      bones: sk.bones.length
    },
    roots: sk.bones
      .filter((b) => !b.parent)
      .map((b) => ({
        name: b.name,
        x: +b.x.toFixed(1),
        y: +b.y.toFixed(1),
        scaleX: +b.scaleX.toFixed(3),
        scaleY: +b.scaleY.toFixed(3),
        worldX: +b.worldX.toFixed(1),
        worldY: +b.worldY.toFixed(1),
        a: +b.a.toFixed(3),
        d: +b.d.toFixed(3)
      })),
    attachedSamples: []
  }

  for (const slot of sk.slots) {
    const a = slot.getAttachment()
    if (!a || !slot.bone) continue
    const entry = {
      slot: slot.name,
      type: a.constructor.name,
      blend: slot.data.blendMode,
      boneScale: [+slot.bone.a.toFixed(3), +slot.bone.d.toFixed(3)]
    }
    if (a instanceof MeshAttachment) {
      const wv = new Float32Array(a.worldVerticesLength)
      try {
        a.computeWorldVertices(slot, 0, a.worldVerticesLength, wv, 0, 2)
        entry.verts = a.worldVerticesLength / 2
        entry.first = [+wv[0].toFixed(1), +wv[1].toFixed(1)]
        let mn = Infinity
        let mx = -Infinity
        let bad = 0
        for (const v of wv) {
          if (!Number.isFinite(v)) bad++
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
        entry.span = [+mn.toFixed(1), +mx.toFixed(1)]
        entry.nonFinite = bad
      } catch (e) {
        entry.error = String(e.message)
      }
    }
    report.attachedSamples.push(entry)
    if (report.attachedSamples.length >= 10) break
  }
  return report
})

console.log(JSON.stringify(out, null, 1))
await browser.close()
