/**
 * 一次性把「可见内容在世界里的真实分布」和「机位该设成什么」都算出来。
 *
 * 前面几轮一直在用搜索/试凑（fitToContent 迭代、autofit 扫 zoom），
 * 都不收敛 —— 那说明输入量就是错的。这个探针不猜：
 *   ① 把当前姿态下**每个带附件的插槽**的世界坐标列出来，看它们真实分布；
 *   ② 用 RegionAttachment 的宽高算每个附件的外扩；
 *   ③ 打印骨骼坐标与附件坐标的差距 —— 这个差距能解释「按骨骼取景总是错」；
 *   ④ 顺手给出按附件范围算出来的机位（zoom + position）作为对照。
 *
 *   node scripts/probe-shittim-frame2.mjs
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

const report = await page.evaluate(() => {
  const st = window.__scene.stage()
  const { RegionAttachment, MeshAttachment } = st.core
  const out = {}

  for (const id of ['arona', 'office-day']) {
    const item = st.items.get(id)
    const anim = id === 'arona' ? 'Idle_01' : 'Idle_00'
    item.state.setAnimation(0, anim, true)
    for (let i = 0; i < 24; i++) {
      item.state.update(1 / 30)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(st.core.Physics.update)
    }

    const sk = item.skeleton
    const slots = []
    let aMinX = Infinity
    let aMinY = Infinity
    let aMaxX = -Infinity
    let aMaxY = -Infinity

    for (const slot of sk.slots) {
      const a = slot.getAttachment()
      if (!a || !slot.bone) continue
      const bx = slot.bone.worldX
      const by = slot.bone.worldY
      let box = null

      if (a instanceof RegionAttachment) {
        // region 没有权重，宽高就是它自己的尺寸（世界尺度由骨骼缩放决定）
        const s = Math.max(Math.abs(slot.bone.a), Math.abs(slot.bone.d), 1e-6)
        const hw = (Math.abs(a.width || 0) / 2) * s
        const hh = (Math.abs(a.height || 0) / 2) * s
        box = { minX: bx - hw, maxX: bx + hw, minY: by - hh, maxY: by + hh }
      } else if (a instanceof MeshAttachment) {
        // mesh：用 computeWorldVertices 拿真实世界顶点（这才是权威值）
        const n = a.worldVerticesLength / 2
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
        for (let i = 0; i < n; i++) {
          const x = wv[i * 2]
          const y = wv[i * 2 + 1]
          if (x < mnx) mnx = x
          if (x > mxx) mxx = x
          if (y < mny) mny = y
          if (y > mxy) mxy = y
        }
        box = { minX: mnx, maxX: mxx, minY: mny, maxY: mxy }
      } else {
        continue
      }
      if (!box || !Number.isFinite(box.minX)) continue

      if (box.minX < aMinX) aMinX = box.minX
      if (box.maxX > aMaxX) aMaxX = box.maxX
      if (box.minY < aMinY) aMinY = box.minY
      if (box.maxY > aMaxY) aMaxY = box.maxY

      slots.push({
        slot: slot.name,
        type: a.constructor.name === 'Le' ? 'mesh' : 'region',
        bone: [+bx.toFixed(1), +by.toFixed(1)],
        box: [Math.round(box.minX), Math.round(box.minY), Math.round(box.maxX), Math.round(box.maxY)],
        size: [Math.round(box.maxX - box.minX), Math.round(box.maxY - box.minY)]
      })
    }

    out[id] = {
      anim,
      attachedSlots: slots.length,
      attachmentBox: [Math.round(aMinX), Math.round(aMinY), Math.round(aMaxX), Math.round(aMaxY)],
      attachmentSize: [Math.round(aMaxX - aMinX), Math.round(aMaxY - aMinY)],
      boneBox: (() => {
        const bb = st.boneBounds(id)
        return bb ? [Math.round(bb.minX), Math.round(bb.minY), Math.round(bb.maxX), Math.round(bb.maxY)] : null
      })(),
      // 排在最前/最后的几个附件，看分布
      sample: slots.slice(0, 5),
      largest: [...slots].sort((p, q) => q.size[0] * q.size[1] - p.size[0] * p.size[1]).slice(0, 3)
    }
  }
  return out
})

console.log(JSON.stringify(report, null, 1))
await browser.close()
