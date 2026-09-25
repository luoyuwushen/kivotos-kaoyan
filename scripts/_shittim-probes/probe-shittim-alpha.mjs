/**
 * 把「精灵几乎透明」这件事拆到底：
 *   · 顶点色/插槽色 alpha 是否正常（已知：有 1 也有 0，正常）
 *   · 渲染器实际用了什么混合函数
 *   · 换两次绘制调用的 premultipliedAlpha 参数，看 alpha 极值有没有变化
 *
 *   node scripts/probe-shittim-alpha.mjs
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
  const gl = st.gl
  window.__scene.only(['arona'])
  const item = st.items.get('arona')
  item.state.setAnimation(0, 'Idle_01', true)
  for (let i = 0; i < 30; i++) {
    item.state.update(1 / 30)
    item.state.apply(item.skeleton)
    item.skeleton.updateWorldTransform(st.core.Physics.update)
  }
  st.fitTo(st.boneBounds('arona'))

  /** 从 dataURL 统计 alpha 极值与分布 */
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
    const buckets = {}
    let opaque = 0
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i]
      if (a > 0) {
        if (a < lo) lo = a
        if (a > hi) hi = a
        buckets[a] = (buckets[a] || 0) + 1
      }
      if (a > 200) opaque++
    }
    const top = Object.entries(buckets)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 6)
      .map(([k, v]) => `a=${k}:${v}`)
    return { lo: lo === 255 ? 0 : lo, hi, opaque, top }
  }

  const out = { blendBefore: {} }
  gl.getParameter && null
  out.blendBefore = {
    srcRGB: gl.getParameter(gl.BLEND_SRC_RGB),
    dstRGB: gl.getParameter(gl.BLEND_DST_RGB),
    srcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA),
    dstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
    enabled: gl.isEnabled(gl.BLEND)
  }

  out.baseline = await alphaStats()

  // 强制普通 alpha 混合（非预乘）后重测，用于判断是不是混合方程把 alpha 压掉了
  gl.enable(gl.BLEND)
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  out.afterStraightBlend = await alphaStats()

  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  out.afterPremulBlend = await alphaStats()

  return out
})

console.log(JSON.stringify(report, null, 1))
await browser.close()
