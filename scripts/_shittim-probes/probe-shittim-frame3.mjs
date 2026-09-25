/**
 * 用「所有附件的世界顶点并集」精确取景，并把结果存图。
 *
 * 和之前几版的差别：不再相信 boneBounds（骨骼范围 ≠ 可见范围，
 * 这套素材里骨骼分布比贴图窄得多），改成逐顶点累加所有 mesh / region 的世界坐标，
 * 然后按 16:9 裁切（参考图 thumb-*.png 就是 16:9）算出 zoom 与相机中心。
 *
 *   node scripts/probe-shittim-frame3.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-frame3')
await mkdir(OUT, { recursive: true })

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

const CASES = [
  { ids: ['office-day'], anim: 'Idle_00' },
  { ids: ['office-day'], anim: 'Idle_01' },
  { ids: ['office-day'], anim: 'Idle_02' },
  { ids: ['office-day'], anim: 'Idle_03' },
  { ids: ['arona'], anim: 'Idle_01' }
]

for (const c of CASES) {
  const r = await page.evaluate(
    async ({ ids, anim }) => {
      const st = window.__scene.stage()
      const { MeshAttachment, RegionAttachment } = st.core
      window.__scene.only(ids)

      for (const id of ids) {
        const item = st.items.get(id)
        item.state.setAnimation(0, anim, true)
        for (let i = 0; i < 26; i++) {
          item.state.update(1 / 30)
          item.state.apply(item.skeleton)
          item.skeleton.updateWorldTransform(st.core.Physics.update)
        }
      }
      st.resize()

      // 逐顶点累加所有附件的世界坐标
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let verts = 0
      const buf = new Float32Array(16384)
      for (const id of ids) {
        const item = st.items.get(id)
        for (const slot of item.skeleton.slots) {
          const a = slot.getAttachment()
          if (!a || !slot.bone) continue
          if (a instanceof MeshAttachment) {
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
              if (!Number.isFinite(x) || !Number.isFinite(y)) continue
              verts++
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
            }
          } else if (a instanceof RegionAttachment) {
            const o = new Float32Array(8)
            try {
              a.computeWorldVertices(slot, o, 0, 2)
            } catch {
              continue
            }
            for (let i = 0; i < 8; i += 2) {
              const x = o[i]
              const y = o[i + 1]
              if (!Number.isFinite(x) || !Number.isFinite(y)) continue
              verts++
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
            }
          }
        }
      }
      if (!Number.isFinite(minX)) return { error: '附件包围盒为空' }

      const bw = maxX - minX
      const bh = maxY - minY
      // 16:9 画布：cover 语义 —— 取较小的那个 zoom，保证两条边都装得下
      const cw = st.canvas.width
      const ch = st.canvas.height
      const zoom = Math.min(cw / bw, ch / bh) * 0.98
      st.camera.zoom = zoom
      st.camera.position.x = (minX + maxX) / 2
      st.camera.position.y = (minY + maxY) / 2
      st.camera.update()

      return {
        verts,
        box: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)],
        size: [Math.round(bw), Math.round(bh)],
        zoom: +zoom.toFixed(5),
        visible: [Math.round(cw / zoom), Math.round(ch / zoom)],
        canvas: [cw, ch],
        dataUrl: st.snapshot()
      }
    },
    { ids: c.ids, anim: c.anim }
  )

  if (r.error) {
    console.log(`${c.ids.join('+')}/${c.anim}: ${r.error}`)
    continue
  }
  const name = `${c.ids.join('+')}-${c.anim}.png`
  await writeFile(join(OUT, name), Buffer.from(r.dataUrl.split(',')[1], 'base64'))
  console.log(
    `${name.padEnd(26)} 顶点 ${String(r.verts).padStart(5)}` +
      ` 附件盒 ${r.box.join(',')}` +
      ` 尺寸 ${r.size.join('×')}` +
      ` zoom ${r.zoom}` +
      ` 可见 ${r.visible.join('×')}`
  )
}

console.log('\n输出目录:', OUT)
await browser.close()
