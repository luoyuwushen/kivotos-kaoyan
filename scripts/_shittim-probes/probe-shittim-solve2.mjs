/**
 * 用「与发行版预览图的差异」作为目标函数，直接搜出正确机位。
 *
 * 为什么用搜索而不是继续推算：骨骼坐标空间和网格世界坐标对不上，
 * 任何基于骨骼/附件包围盒的"算出机位"都会偏。而参考图 thumb-day_*.png
 * 就是标准答案 —— 把差异量化出来，直接在 (相机中心, 缩放) 上做坐标下降，
 * 每轮只需渲染一张 480×270 的图，几十轮就收敛。
 *
 *   node scripts/probe-shittim-solve.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const SRC = String.raw`D:\下载\ShittimLogon-1.4.1\ShittimLogon-1.4.1\assets`
const OUT = join(tmpdir(), 'kaoyan-solve2')
await mkdir(OUT, { recursive: true })

const THUMB = (await readFile(join(SRC, 'thumb-day_1.png'))).toString('base64')

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

// 准备：只显示 office-day，播 Idle_00，并把参考图作为全局变量注入
await page.evaluate(async (thumb) => {
  const st = window.__scene.stage()
  window.__scene.only(['office-day'])
  const item = st.items.get('office-day')
  item.state.setAnimation(0, 'Idle_00', true)
  for (let i = 0; i < 26; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  const im = new Image()
  await new Promise((res) => {
    im.onload = res
    im.src = 'data:image/png;base64,' + thumb
  })
  window.__ref = im
  // 参考图的缩略签名（32×18）
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 18
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(im, 0, 0, 32, 18)
  window.__refSig = ctx.getImageData(0, 0, 32, 18).data
}, THUMB)

/** 给一组机位参数 → 渲染 + 与参考图的差异 */
const score = (camX, camY, zoom) =>
  page.evaluate(
    async ({ camX, camY, zoom }) => {
      const st = window.__scene.stage()
      st.resize()
      st.camera.zoom = zoom
      st.camera.position.x = camX
      st.camera.position.y = camY
      st.camera.update()

      const url = st.snapshot()
      const bin = atob(url.split(',')[1])
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const oc = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = oc.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0)
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data

      // 合成到浅色底（参考图是不透明的），再取 32×18 签名
      const cc = document.createElement('canvas')
      cc.width = 32
      cc.height = 18
      const cctx = cc.getContext('2d', { willReadFrequently: true })
      cctx.fillStyle = '#ffffff'
      cctx.fillRect(0, 0, 32, 18)
      // 把渲染结果画上去
      const tmp = document.createElement('canvas')
      tmp.width = bmp.width
      tmp.height = bmp.height
      tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), bmp.width, bmp.height), 0, 0)
      cctx.drawImage(tmp, 0, 0, 32, 18)
      const sig = cctx.getImageData(0, 0, 32, 18).data

      const ref = window.__refSig
      let s = 0
      for (let i = 0; i < sig.length; i += 4) {
        s += Math.abs(sig[i] - ref[i]) + Math.abs(sig[i + 1] - ref[i + 1]) + Math.abs(sig[i + 2] - ref[i + 2])
      }
      return { diff: +(s / (sig.length / 4) / 3).toFixed(2), dataUrl: url }
    },
    { camX, camY, zoom }
  )

// 起点：用附件包围盒（几何对、构图不对，但足够做搜索起点）
const start = await page.evaluate(() => {
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
  const cw = st.canvas.width
  const ch = st.canvas.height
  return {
    camX: (minX + maxX) / 2,
    camY: (minY + maxY) / 2,
    zoom: Math.min(cw / (maxX - minX), ch / (maxY - minY))
  }
})

console.log('搜索起点:', JSON.stringify(start))

let best = { ...start }
let bestR = await score(best.camX, best.camY, best.zoom)
console.log(`起点差异 ${bestR.diff}`)

// 坐标下降：每轮在 4 个方向 + 缩放上试探，步长逐轮减半
const totalW = 480 / best.zoom
const totalH = 270 / best.zoom
let stepXY = Math.max(totalW, totalH) * 0.25
let stepZ = best.zoom * 0.5

for (let round = 0; round < 9; round++) {
  let improved = false
  const candidates = [
    [best.camX + stepXY, best.camY, best.zoom],
    [best.camX - stepXY, best.camY, best.zoom],
    [best.camX, best.camY + stepXY, best.zoom],
    [best.camX, best.camY - stepXY, best.zoom],
    [best.camX, best.camY, best.zoom * (1 + stepZ / best.zoom / 2)],
    [best.camX, best.camY, best.zoom * (1 - stepZ / best.zoom / 2)]
  ]
  for (const [x, y, z] of candidates) {
    const r = await score(x, y, z)
    if (r.diff < bestR.diff) {
      best = { camX: x, camY: y, zoom: z }
      bestR = r
      improved = true
    }
  }
  console.log(
    `第 ${round + 1} 轮  差异 ${bestR.diff}  中心 (${Math.round(best.camX)}, ${Math.round(best.camY)})  zoom ${best.zoom.toFixed(5)}`
  )
  if (!improved) {
    stepXY *= 0.5
    stepZ *= 0.5
  }
}

await writeFile(join(OUT, 'solved.png'), Buffer.from(bestR.dataUrl.split(',')[1], 'base64'))
// 与参考图并排
const merged = await page.evaluate(
  async ({ mine, ref }) => {
    const load = (b64) =>
      new Promise((res) => {
        const im = new Image()
        im.onload = () => res(im)
        im.src = 'data:image/png;base64,' + b64
      })
    const a = await load(mine.split(',')[1])
    const b = await load(ref)
    const W = 480
    const ah = Math.round((a.height / a.width) * W)
    const bh = Math.round((b.height / b.width) * W)
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = ah + bh + 6
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#20303f'
    ctx.fillRect(0, 0, W, cv.height)
    ctx.drawImage(a, 0, 0, W, ah)
    ctx.drawImage(b, 0, ah + 6, W, bh)
    ctx.fillStyle = '#ff5d5d'
    ctx.fillRect(0, ah, W, 6)
    return cv.toDataURL('image/png')
  },
  { mine: bestR.dataUrl, ref: THUMB }
)
await writeFile(join(OUT, 'solved-compare.png'), Buffer.from(merged.split(',')[1], 'base64'))

console.log('\n最优:', JSON.stringify({ camX: Math.round(best.camX), camY: Math.round(best.camY), zoom: +best.zoom.toFixed(5) }))
console.log('输出目录:', OUT)
await browser.close()
