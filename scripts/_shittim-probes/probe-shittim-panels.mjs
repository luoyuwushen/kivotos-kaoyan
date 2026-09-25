/**
 * 隐藏几个「超大背景面板」后再取景 —— 验证画面是否恢复正常构图。
 *
 * 已知事实：
 *   · office-day 全屏框住时，是一大片地板/光斑面板占据画面（放大 6 倍的后果）
 *   · 参考图 thumb-day_*.png 其实是**近景**：两个角色 + 身边桌椅 + 窗外海景，
 *     并不是整间教室的全景
 *   · Black_Waterlight_01（3956×1436）/ Black_class_room（2138×2706）/
 *     Black_Floor（2176×1194）这几个是铺满整屏的背景面板，
 *     全场景构图下它们会把画面糊成一片白（实测色数从 21 掉到 1）
 *
 * 做法：隐藏这几个面板，只按「角色 + 道具」的附件范围取景，再和参考图并排比。
 *
 *   node scripts/probe-shittim-panels.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const SRC = String.raw`D:\下载\ShittimLogon-1.4.1\ShittimLogon-1.4.1\assets`
const OUT = join(tmpdir(), 'kaoyan-panels')
await mkdir(OUT, { recursive: true })

const PAIRS = [
  { thumb: 'thumb-day_1.png', anim: 'Idle_00' },
  { thumb: 'thumb-day_2.png', anim: 'Idle_01' },
  { thumb: 'thumb-day_3.png', anim: 'Idle_02' },
  { thumb: 'thumb-day_4.png', anim: 'Idle_03' }
]

/** 铺满全屏的背景面板，隐藏后画面才看得清 */
const PANELS = ['Black_Waterlight_01', 'Black_class_room', 'Black_Floor', 'Black_Floor_02']

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

for (const pair of PAIRS) {
  const r = await page.evaluate(
    async ({ anim, panels }) => {
      const st = window.__scene.stage()
      const { MeshAttachment, RegionAttachment } = st.core
      window.__scene.only(['office-day'])
      const item = st.items.get('office-day')

      // 每次从头摆姿势，避免上一次清空的残留
      item.state.clearTracks()
      item.skeleton.setToSetupPose()
      item.state.setAnimation(0, anim, true)
      for (let i = 0; i < 26; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }

      // 隐藏铺满全屏的背景面板
      let hidden = 0
      for (const slot of item.skeleton.slots) {
        const nm = slot?.data?.name || ''
        if (panels.includes(nm) && slot.getAttachment()) {
          slot.setAttachment(null)
          hidden++
        }
      }
      item.skeleton.updateWorldTransform(st.core.Physics.update)
      st.resize()

      // 按剩下附件的世界范围取景
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
      if (!Number.isFinite(minX)) return { error: '没有可见附件' }

      const cw = st.canvas.width
      const ch = st.canvas.height
      const bw = Math.max(maxX - minX, 1)
      const bh = Math.max(maxY - minY, 1)
      // fill 语义：Math.max 保证填满画面（参考图是近景，不是全景）
      const zoom = Math.max(cw / bw, ch / bh) * 1.0
      st.camera.zoom = zoom
      st.camera.position.x = (minX + maxX) / 2
      st.camera.position.y = (minY + maxY) / 2
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
      const hist = new Map()
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue
        const k = ((d[i] >> 5) << 10) | ((d[i + 1] >> 5) << 5) | (d[i + 2] >> 5)
        hist.set(k, (hist.get(k) || 0) + 1)
      }
      return {
        hidden,
        box: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)],
        size: [Math.round(bw), Math.round(bh)],
        zoom: +zoom.toFixed(5),
        colors: hist.size,
        dataUrl: url
      }
    },
    { anim: pair.anim, panels: PANELS }
  )

  if (r.error) {
    console.log(`${pair.anim}: ${r.error}`)
    continue
  }

  const thumb = (await readFile(join(SRC, pair.thumb))).toString('base64')
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
    { mine: r.dataUrl, ref: thumb }
  )
  await writeFile(join(OUT, `panel-${pair.anim}.png`), Buffer.from(merged.split(',')[1], 'base64'))
  console.log(
    `${pair.anim.padEnd(9)} 隐藏面板 ${r.hidden}` +
      ` 附件盒 ${r.size.join('×').padEnd(11)} zoom ${String(r.zoom).padEnd(8)} 色数 ${r.colors}`
  )
}

console.log('\n输出目录:', OUT)
await browser.close()
