/**
 * 复现「原效果」：对准角色取景 + 隐藏铺满全屏的背景面板。
 *
 * 上一版为什么失败（色数 0）：清空附件之后又调了 updateWorldTransform / resize，
 * 而 state.apply() 与后续步骤会把附件重新挂上、或让骨架处于半更新状态，
 * 结果画出来是空的。
 *
 * 正确顺序（这个脚本按它来）：
 *   ① 摆姿势（update + apply + updateWorldTransform）
 *   ② 清掉不要的附件
 *   ③ 只调 updateWorldTransform 一次（不再 apply、不再改动画）
 *   ④ 设相机 → 立刻 snapshot（中间不插入任何会重置状态的操作）
 *
 *   node scripts/probe-shittim-hero2.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const SRC = String.raw`D:\下载\ShittimLogon-1.4.1\ShittimLogon-1.4.1\assets`
const OUT = join(tmpdir(), 'kaoyan-hero2')
await mkdir(OUT, { recursive: true })

/** 这几个是铺满全屏的背景面板，近景构图下会糊住画面（实测 Waterlight 一个就够） */
const PANELS = ['Black_Waterlight_01', 'Black_class_room', 'Black_Floor', 'Black_Floor_02']

const PAIRS = [
  { thumb: 'thumb-day_1.png', anim: 'Idle_00' },
  { thumb: 'thumb-day_2.png', anim: 'Idle_01' },
  { thumb: 'thumb-day_3.png', anim: 'Idle_02' },
  { thumb: 'thumb-day_4.png', anim: 'Idle_03' }
]

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

/**
 * 渲染一帧。
 * @param hidePanels 是否隐藏铺满全屏的背景面板
 * @param useAttachedBox true=按剩余附件范围取景；false=用给定的相机
 */
const render = ({ anim, hidePanels, camX, camY, zoom }) =>
  page.evaluate(
    async ({ anim, hidePanels, camX, camY, zoom, panels }) => {
      const st = window.__scene.stage()
      const { MeshAttachment, RegionAttachment } = st.core
      window.__scene.only(['office-day'])
      const item = st.items.get('office-day')

      // ① 摆姿势
      item.state.clearTracks()
      item.skeleton.setToSetupPose()
      item.state.setAnimation(0, anim, true)
      for (let i = 0; i < 26; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }

      // ② 清掉不要的附件
      let hidden = 0
      if (hidePanels) {
        for (const slot of item.skeleton.slots) {
          const nm = slot?.data?.name || ''
          if (panels.includes(nm) && slot.getAttachment()) {
            slot.setAttachment(null)
            hidden++
          }
        }
      }

      // ③ 只更新一次世界变换
      item.skeleton.updateWorldTransform(st.core.Physics.update)
      st.resize()

      // ④ 取景
      let box = null
      if (camX === undefined || camY === undefined || zoom === undefined) {
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
        if (Number.isFinite(minX)) box = { minX, minY, maxX, maxY }
      }

      const cw = st.canvas.width
      const ch = st.canvas.height
      if (box) {
        const bw = Math.max(box.maxX - box.minX, 1)
        const bh = Math.max(box.maxY - box.minY, 1)
        st.camera.zoom = Math.max(cw / bw, ch / bh)
        st.camera.position.x = (box.minX + box.maxX) / 2
        st.camera.position.y = (box.minY + box.maxY) / 2
      } else {
        st.camera.zoom = zoom
        st.camera.position.x = camX
        st.camera.position.y = camY
      }
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
      let opaque = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue
        opaque++
        const k = ((d[i] >> 5) << 10) | ((d[i + 1] >> 5) << 5) | (d[i + 2] >> 5)
        hist.set(k, (hist.get(k) || 0) + 1)
      }
      return {
        hidden,
        box,
        zoom: +st.camera.zoom.toFixed(5),
        camPos: [+st.camera.position.x.toFixed(1), +st.camera.position.y.toFixed(1)],
        opaque,
        colors: hist.size,
        dataUrl: url
      }
    },
    { anim, hidePanels, camX, camY, zoom, panels: PANELS }
  )

console.log('=== 先试「隐藏面板 + 按剩余附件取景」 ===')
const first = await render({ anim: 'Idle_00', hidePanels: true })
console.log(
  `  隐藏 ${first.hidden} 个面板  相机 ${first.camPos.join(',')} zoom ${first.zoom}` +
    `  不透明 ${first.opaque} 色数 ${first.colors}`
)

if (first.colors > 5) {
  console.log('\n=== 四段 Idle 全部出图 ===')
  for (const pair of PAIRS) {
    const r = await render({ anim: pair.anim, hidePanels: true })
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
    await writeFile(join(OUT, `hero-${pair.anim}.png`), Buffer.from(merged.split(',')[1], 'base64'))
    console.log(
      `${pair.anim.padEnd(9)} 相机 ${r.camPos.join(',').padEnd(14)} zoom ${String(r.zoom).padEnd(8)}` +
        ` 不透明 ${String(r.opaque).padStart(6)} 色数 ${r.colors}`
    )
  }
} else {
  console.log('\n  取景仍然出不来，改试固定相机（按角色组 A_02 的范围手工给一组）')
  for (const cam of [
    { camX: -1500, camY: 2400, zoom: 0.15 },
    { camX: -1500, camY: 2400, zoom: 0.3 },
    { camX: -1500, camY: 2400, zoom: 0.6 }
  ]) {
    const r = await render({ anim: 'Idle_00', hidePanels: true, ...cam })
    console.log(
      `  相机 ${r.camPos.join(',')} zoom ${r.zoom}  不透明 ${r.opaque} 色数 ${r.colors}`
    )
  }
}

console.log('\n输出目录:', OUT)
await browser.close()
