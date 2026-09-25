/**
 * 验证假设：atlas 里的 `scale:` 字段把 UV / 尺寸算错了。
 *
 * 背景：这几套 atlas 带 `scale: 1.3`（arona）/ `1.24`（daytime）/ `1.12`（nighttime）。
 * spine 运行时会拿它换算附件尺寸；我们又把贴图降采样了一半并改写了 `size:`。
 * 如果这两件事叠在一起让 UV 落到图集留白上，画出来就会「有色但几乎全透明」——
 * 正是现在的现象。
 *
 * 做法：把 atlas.scale 强制设成 1，重算附件 region，再测 alpha 分布。
 *
 *   node scripts/probe-shittim-scale.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 600, height: 600 }, locale: 'zh-CN' })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}?cb=${Date.now()}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 60000 })

const report = await page.evaluate(async () => {
  const st = window.__scene.stage()

  /** 渲染一帧并统计 alpha 极值 */
  async function alphaStats() {
    const url = st.snapshot()
    const bin = atob(url.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = oc.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let lo = 255
    let hi = 0
    let opaque = 0
    let n = 0
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i]
      if (!a) continue
      n++
      if (a < lo) lo = a
      if (a > hi) hi = a
      if (a > 200) opaque++
    }
    return { lo: n ? lo : 0, hi, opaque, visiblePixels: n }
  }

  const out = { atlasScales: {}, baseline: null, forcedScale1: null }
  for (const [id, item] of st.items) out.atlasScales[id] = item.atlas.scale

  // 摆好姿态
  window.__scene.only(['arona'])
  const item = st.items.get('arona')
  item.state.setAnimation(0, 'Idle_01', true)
  for (let i = 0; i < 24; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  st.fitTo(st.boneBounds('arona'))
  out.baseline = await alphaStats()

  // 强制 scale = 1，并把所有附件的 region 重算一遍
  const { RegionAttachment, MeshAttachment } = st.core
  for (const [, it] of st.items) {
    it.atlas.scale = 1
    for (const slot of it.skeleton.slots) {
      const a = slot.getAttachment()
      if (!a) continue
      if (a instanceof RegionAttachment) {
        a.updateRegion?.()
      } else if (a instanceof MeshAttachment) {
        a.updateRegion?.()
        a.updateUVs?.()
      }
    }
  }
  // 让动画重新 apply 一次，把新 UV 带进顶点
  for (let i = 0; i < 6; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  st.fitTo(st.boneBounds('arona'))
  out.forcedScale1 = await alphaStats()

  return out
})

console.log(JSON.stringify(report, null, 1))
await browser.close()
