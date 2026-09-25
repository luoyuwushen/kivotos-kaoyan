/**
 * 验证「画面块状像素化」是不是 mipmap / 滤波造成的。
 *
 * 现象：渲染结果和发行版预览图构图一致、配色一致，但整体像被降到了 1/8 分辨率、
 * 大片色块、边缘锯齿。这种"信息量变少但内容正确"的特征，典型来源是
 * GPU 采样到了很粗的 mip 层级，或者 MIN_FILTER 要求 mipmap 却没生成。
 *
 * 做法：把 pages 的贴图重新上传，用几种滤波组合各拍一张对比。
 *
 *   node scripts/probe-shittim-filter.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-filter')
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

/** 摆好姿势 + 按附件范围取景 */
const setup = () =>
  page.evaluate(() => {
    const st = window.__scene.stage()
    const { MeshAttachment, RegionAttachment } = st.core
    window.__scene.only(['office-day'])
    const item = st.items.get('office-day')
    item.state.setAnimation(0, 'Idle_00', true)
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
      }
    }
    if (Number.isFinite(minX)) {
      const px = (maxX - minX) * 0.04
      const py = (maxY - minY) * 0.04
      st.fitTo({ minX: minX - px, maxX: maxX + px, minY: minY - py, maxY: maxY + py })
    }
    // 报告贴图状态
    return {
      pages: [...st.items.values()].flatMap((it) =>
        it.atlas.pages.map((pg) => ({
          name: pg.name,
          size: [pg.width, pg.height],
          min: pg.minFilter,
          mag: pg.magFilter,
          uWrap: pg.uWrap,
          vWrap: pg.vWrap,
          img: pg.texture?.getImage?.() ? [pg.texture.getImage().width, pg.texture.getImage().height] : null
        }))
      )
    }
  })

const info = await setup()
console.log('=== 图集页面状态 ===')
console.log(JSON.stringify(info, null, 1))

/** 重新上传贴图并指定滤波组合 */
const setFilter = (mode) =>
  page.evaluate((m) => {
    const st = window.__scene.stage()
    const gl = st.gl
    for (const it of st.items.values()) {
      for (const pg of it.atlas.pages) {
        const img = pg.texture?.getImage?.()
        if (!img) continue
        gl.bindTexture(gl.TEXTURE_2D, pg.texture.glTexture)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        if (m === 'nearest') {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        } else if (m === 'linear') {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        } else if (m === 'mipmap') {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.generateMipmap(gl.TEXTURE_2D)
        }
        gl.bindTexture(gl.TEXTURE_2D, null)
      }
    }
    return m
  }, mode)

for (const mode of ['nearest', 'linear', 'mipmap']) {
  await setFilter(mode)
  await page.waitForTimeout(200)
  const url = await page.evaluate(() => window.__scene.snapshot())
  await writeFile(join(OUT, `filter-${mode}.png`), Buffer.from(url.split(',')[1], 'base64'))
  // 量化「细节量」：相邻像素差越大说明越锐利（块状化会先降后升，配合看图判断）
  const d = await page.evaluate(async (u) => {
    const bin = atob(u.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = oc.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let sum = 0
    let n = 0
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 1; x < bmp.width; x++) {
        const i = (y * bmp.width + x) * 4
        const j = i - 4
        sum += Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2])
        n++
      }
    }
    const hist = new Map()
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) continue
      const k = ((px[i] >> 5) << 10) | ((px[i + 1] >> 5) << 5) | (px[i + 2] >> 5)
      hist.set(k, (hist.get(k) || 0) + 1)
    }
    return { avgEdge: +(sum / Math.max(n, 1)).toFixed(2), colors: hist.size }
  }, url)
  console.log(`  filter=${mode.padEnd(8)} 相邻像素平均差 ${String(d.avgEdge).padStart(6)}  色数 ${d.colors}`)
}

console.log('\n输出目录:', OUT)
await browser.close()
