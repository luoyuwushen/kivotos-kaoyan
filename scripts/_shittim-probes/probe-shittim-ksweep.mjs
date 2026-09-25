/**
 * 标定整体几何缩放 `SkeletonBinary.scale`。
 *
 * 背景：`atlas.scale` 改不动几何（实测），真正决定世界尺寸的是 `SkeletonBinary.scale`。
 * 系数不对时所有精灵等比缩放 —— 表现是"特写"或"蚂蚁"。
 * 这里扫几档，用「渲染出来的人物构图」量化指标挑最优：
 *   · 主色占比   越低越好（< 0.6 说明画面有层次，不是被一大块占满）
 *   · 色数       越多越好（> 30）
 *   · 不透明占比 适中最好（0.3–0.85；太低说明人物太小，太高说明顶满画面）
 *
 *   node scripts/probe-shittim-ksweep.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-ksweep')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 480, height: 480 }, locale: 'zh-CN' })
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

/** 渲染并量化 */
const evaluate = (id, anim) =>
  page.evaluate(
    async ({ id, anim }) => {
      const st = window.__scene.stage()
      const { MeshAttachment, RegionAttachment } = st.core
      window.__scene.only([id])
      const item = st.items.get(id)
      item.state.setAnimation(0, anim, true)
      for (let i = 0; i < 26; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }
      st.resize()

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      const buf = new Float32Array(8192)
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
            if (!Number.isFinite(x)) continue
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
            if (!Number.isFinite(x)) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (!Number.isFinite(minX)) return { empty: true }
      const px = (maxX - minX) * 0.08
      const py = (maxY - minY) * 0.08
      st.fitTo({ minX: minX - px, maxX: maxX + px, minY: minY - py, maxY: maxY + py })

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
      let maxA = 0
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3]
        if (a < 8) continue
        opaque++
        if (a > maxA) maxA = a
        const key = ((d[i] >> 5) << 10) | ((d[i + 1] >> 5) << 5) | (d[i + 2] >> 5)
        hist.set(key, (hist.get(key) || 0) + 1)
      }
      const top = [...hist.values()].sort((p, q) => q - p)
      const total = bmp.width * bmp.height
      return {
        geoSize: [Math.round(maxX - minX), Math.round(maxY - minY)],
        opaqueShare: +(opaque / total).toFixed(3),
        maxAlpha: maxA,
        distinctColors: hist.size,
        topColorShare: opaque ? +(top[0] / opaque).toFixed(3) : 0,
        dataUrl: url
      }
    },
    { id, anim }
  )

const K_VALUES = [0.5, 1, 1.5, 2, 2.5, 3]

for (const k of K_VALUES) {
  await page.evaluate((kk) => window.__scene.setScale(kk), k)
  await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 30000 })
  const r = await evaluate('arona', 'Idle_01')
  if (r.empty) {
    console.log(`k=${k}  空`)
    continue
  }
  const { dataUrl, ...rest } = r
  await writeFile(join(OUT, `k-${k}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
  // 打分：色数多、主色占比低、不透明占比适中
  const score =
    (rest.distinctColors > 30 ? 2 : 0) +
    (rest.topColorShare < 0.6 ? 2 : 0) +
    (rest.opaqueShare > 0.25 && rest.opaqueShare < 0.9 ? 1 : 0)
  console.log(
    `k=${String(k).padEnd(5)} 几何 ${rest.geoSize.join('×').padEnd(11)}` +
      ` 不透明占比 ${String(rest.opaqueShare).padEnd(6)}` +
      ` 色数 ${String(rest.distinctColors).padStart(4)}` +
      ` 主色占比 ${String(rest.topColorShare).padEnd(6)}` +
      ` → 评分 ${score}/5`
  )
}

console.log('\n输出目录:', OUT)
await browser.close()
