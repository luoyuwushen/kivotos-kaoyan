/**
 * 对齐官方取景：扫 zoom，找出与官方渲染最接近的那一档。
 *
 * 依据：官方 render_still.exe 输出的 PNG 就是"原本的效果"本身
 * （和登录界面共用同一套渲染代码，日志 [0]~[6] 完全一致）。
 * 实测官方 1280×720 的 day_1：课桌黄纵向占 53%，位于 20%~73%。
 *
 * 这个脚本把官方图作为目标，在 zoom 上做一维扫描，输出每档的差异，
 * 并各存一张图，便于直接看有没有对齐。
 *
 *   node scripts/probe-shittim-matchcam.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OFFICIAL = join(tmpdir(), 'kaoyan-still', 'day_1.png')
const OUT = join(tmpdir(), 'kaoyan-matchcam')
await mkdir(OUT, { recursive: true })

const officialB64 = (await readFile(OFFICIAL)).toString('base64')

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

/** 按官方 track 结构摆姿势：track0 背景 + track1 主角色 + track4 同伴 */
await page.evaluate(() => {
  const st = window.__scene.stage()
  window.__scene.only(['office-day'])
  const item = st.items.get('office-day')
  const tracks = [
    [0, 'Idle_background_00'],
    [1, 'Idle_00'],
    [4, 'Idle_11']
  ]
  for (const [track, name] of tracks) {
    if (item.data.animations.some((a) => a.name === name)) {
      item.state.setAnimation(track, name, true)
    }
  }
  for (let i = 0; i < 60; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  st.resize()
})

/** 附件几何范围（作为机位基准） */
const geo = await page.evaluate(() => {
  const st = window.__scene.stage()
  const { MeshAttachment, RegionAttachment } = st.core
  const item = st.items.get('office-day')
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const buf = new Float32Array(16384)
  for (const slot of item.skeleton.slots) {
    const a = slot.getAttachment()
    if (!a || !slot.bone) continue
    let wv = null
    if (a instanceof MeshAttachment) {
      const need = a.worldVerticesLength
      wv = need <= buf.length ? buf.subarray(0, need) : new Float32Array(need)
      try {
        a.computeWorldVertices(slot, 0, need, wv, 0, 2)
      } catch {
        continue
      }
    } else if (a instanceof RegionAttachment) {
      wv = new Float32Array(8)
      try {
        a.computeWorldVertices(slot, wv, 0, 2)
      } catch {
        continue
      }
    } else continue
    for (let i = 0; i < wv.length; i += 2) {
      const x = wv[i]
      const y = wv[i + 1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
})

console.log('附件几何范围:', JSON.stringify({
  box: [Math.round(geo.minX), Math.round(geo.minY), Math.round(geo.maxX), Math.round(geo.maxY)],
  size: [Math.round(geo.maxX - geo.minX), Math.round(geo.maxY - geo.minY)]
}))

const shot = (zoom, dx, dy, keep) =>
  page.evaluate(
    async ({ zoom, dx, dy, cx, cy, keep }) => {
      const st = window.__scene.stage()
      st.resize()
      st.camera.zoom = zoom
      st.camera.position.x = cx + dx
      st.camera.position.y = cy + dy
      st.camera.update()
      const url = st.snapshot()

      // 差异计算全部放在页面内完成，不要把 base64 来回传（那样每帧几十 MB，极慢）
      const load = (b64) =>
        new Promise((res) => {
          const im = new Image()
          im.onload = () => res(im)
          im.src = 'data:image/png;base64,' + b64
        })
      const sig = async (src) => {
        const im = await load(src)
        const c = document.createElement('canvas')
        c.width = 32
        c.height = 18
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, 32, 18)
        ctx.drawImage(im, 0, 0, 32, 18)
        return ctx.getImageData(0, 0, 32, 18).data
      }
      const a = await sig(url.split(',')[1])
      const b = await sig(window.__official)
      let s = 0
      for (let i = 0; i < a.length; i += 4) {
        s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      }
      return { zoom, diff: +(s / (a.length / 4) / 3).toFixed(2), dataUrl: keep ? url : '' }
    },
    { zoom, dx, dy, cx: geo.cx, cy: geo.cy, keep }
  )

// 把官方图注入页面，供差异计算用
await page.evaluate(async (b64) => {
  const im = new Image()
  await new Promise((res) => {
    im.onload = res
    im.src = 'data:image/png;base64,' + b64
  })
  window.__official = im
}, officialB64)

// 官方 1280×720 的课桌黄纵向占 53% —— 反推 zoom
// 课桌黄纵向 ≈ 3400 世界单位（几何高 4462 的 53% 上下），屏幕 270px
// zoom ≈ 270 / (4462 * 0.53) ≈ 0.114，围绕它扫
const base = 270 / ((geo.maxY - geo.minY) * 0.53)
console.log(`按「课桌占 53%」反推的基准 zoom ≈ ${base.toFixed(4)}\n`)

let best = null
for (const factor of [0.6, 1.0, 1.6, 2.5]) {
  const r = await shot(base * factor, 0, 0, false)
  console.log(`  zoom ${(base * factor).toFixed(4)} (×${factor})  差异 ${r.diff}`)
  if (!best || r.diff < best.diff) best = { ...r, factor }
}

// 对最优档再细扫，并只在最后取一次图
const fine = await shot(best.zoom, 0, 0, true)
console.log(`\n最接近官方的一档：zoom ${fine.zoom.toFixed(4)} (×${best.factor})  差异 ${fine.diff}`)
if (fine.dataUrl) {
  await writeFile(join(OUT, 'best.png'), Buffer.from(fine.dataUrl.split(',')[1], 'base64'))
}
console.log('输出目录:', OUT)
await browser.close()
