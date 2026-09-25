/**
 * 二分定位：隐藏哪些面板、保留哪些，画面才既不是纯白也不是空白。
 *
 * 已知两个极端：
 *   · 全部面板都在  → 纯白（Waterlight 一个就够糊住全屏）
 *   · 全部面板都清  → 什么都不画（不透明 0）—— 说明清的粒度不对，
 *                     或者清完之后还需要重新 apply 一次动画
 *
 * 这个脚本枚举组合，并对「清完之后再 apply 一次」这条路径也做验证。
 *
 *   node scripts/probe-shittim-grid.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-grid')
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

const run = ({ hide, reapply, hideOnly, fixedCam }) =>
  page.evaluate(
    async ({ hide, reapply, hideOnly, fixedCam }) => {
      const st = window.__scene.stage()
      const { MeshAttachment } = st.core
      window.__scene.only(['office-day'])
      const item = st.items.get('office-day')

      item.state.clearTracks()
      item.skeleton.setToSetupPose()
      item.state.setAnimation(0, 'Idle_00', true)
      for (let i = 0; i < 26; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }

      // 按名字清附件
      let cleared = 0
      for (const slot of item.skeleton.slots) {
        const nm = slot?.data?.name || ''
        if (hide.includes(nm) && slot.getAttachment()) {
          slot.setAttachment(null)
          cleared++
        }
      }

      // 可选：清完再 apply 一次（看看是不是"必须重新 apply"）
      if (reapply) {
        for (let i = 0; i < 3; i++) {
          item.state.update(1 / 30)
          item.state.apply(item.skeleton)
        }
        // 再清一遍（apply 会把它们挂回来）
        for (const slot of item.skeleton.slots) {
          const nm = slot?.data?.name || ''
          if (hide.includes(nm)) slot.setAttachment(null)
        }
      }

      item.skeleton.updateWorldTransform(st.core.Physics.update)

      // 机位
      if (fixedCam) {
        st.camera.zoom = fixedCam.zoom
        st.camera.position.x = fixedCam.x
        st.camera.position.y = fixedCam.y
        st.camera.update()
      } else {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        const buf = new Float32Array(16384)
        for (const slot of item.skeleton.slots) {
          const a = slot.getAttachment()
          if (!(a instanceof MeshAttachment) || !slot.bone) continue
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
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        if (Number.isFinite(minX)) {
          const cw = st.canvas.width
          const ch = st.canvas.height
          st.camera.zoom = Math.max(cw / (maxX - minX), ch / (maxY - minY))
          st.camera.position.x = (minX + maxX) / 2
          st.camera.position.y = (minY + maxY) / 2
          st.camera.update()
        }
      }

      const url = st.snapshot()
      const bin = atob(url.split(',')[1])
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const oc = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = oc.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0)
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      const hist = new Map()
      let opaque = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue
        opaque++
        const k = ((d[i] >> 5) << 10) | ((d[i + 1] >> 5) << 5) | (d[i + 2] >> 5)
        hist.set(k, (hist.get(k) || 0) + 1)
      }
      return {
        cleared,
        opaque,
        colors: hist.size,
        cam: [+st.camera.position.x.toFixed(0), +st.camera.position.y.toFixed(0)],
        zoom: +st.camera.zoom.toFixed(5),
        dataUrl: url
      }
    },
    { hide, reapply, hideOnly, fixedCam }
  )

const CASES = [
  { label: '全都不隐藏', hide: [], reapply: false },
  { label: '只隐藏 Waterlight', hide: ['Black_Waterlight_01'], reapply: false },
  { label: '隐藏 Waterlight+class', hide: ['Black_Waterlight_01', 'Black_class_room'], reapply: false },
  {
    label: '隐藏 4 个面板',
    hide: ['Black_Waterlight_01', 'Black_class_room', 'Black_Floor', 'Black_Floor_02'],
    reapply: false
  },
  {
    label: '隐藏 4 个面板 + 重新 apply',
    hide: ['Black_Waterlight_01', 'Black_class_room', 'Black_Floor', 'Black_Floor_02'],
    reapply: true
  }
]

for (const c of CASES) {
  const r = await run(c)
  console.log(
    `${c.label.padEnd(26)} 清掉 ${String(r.cleared).padStart(2)}  不透明 ${String(r.opaque).padStart(6)}` +
      `  色数 ${String(r.colors).padStart(4)}  相机 ${r.cam.join(',')} zoom ${r.zoom}`
  )
  const name = c.label.replace(/[^\w\u4e00-\u9fa5]+/g, '_')
  await writeFile(join(OUT, `${name}.png`), Buffer.from(r.dataUrl.split(',')[1], 'base64'))
}

console.log('\n输出目录:', OUT)
await browser.close()
