/**
 * 定位「精灵发白」：把「贴图是否预乘」与「绘制时是否按预乘混合」四种组合都试一遍。
 *
 * 背景：WebGL 里这两件事必须配对，配错的表现不是报错，而是颜色被除以 alpha 两次
 * （或一次都没除），于是半透明精灵整体发白、看不出内容。
 *   · 贴图预乘 + premultipliedAlpha=true  → 正确配对
 *   · 贴图直通 + premultipliedAlpha=false → 正确配对
 *   混搭就是发白。
 *
 *   node scripts/probe-shittim-blend.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-blend')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, locale: 'zh-CN' })
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
 * 只画阿洛娜，并用四种组合各拍一张。
 * 贴图的预乘是**加载时**决定的，所以「改贴图预乘」这一半需要重新上传贴图：
 * 这里用 gl.pixelStorei 之后重传一次来实现。
 */
const combos = [
  { texPremul: true, drawPremul: true, label: '1-预乘贴图+预乘绘制' },
  { texPremul: true, drawPremul: false, label: '2-预乘贴图+直通绘制' },
  { texPremul: false, drawPremul: false, label: '3-直通贴图+直通绘制' },
  { texPremul: false, drawPremul: true, label: '4-直通贴图+预乘绘制' }
]

for (const combo of combos) {
  await page.evaluate(
    ({ texPremul, drawPremul }) => {
      const st = window.__scene.stage()
      const gl = st.gl
      window.__scene.only(['arona'])
      const item = st.items.get('arona')

      // 重传贴图，按本组合决定是否预乘
      for (const pg of item.atlas.pages) {
        const img = pg.texture.getImage()
        gl.bindTexture(gl.TEXTURE_2D, pg.texture.glTexture)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texPremul)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.bindTexture(gl.TEXTURE_2D, null)
      }

      // 摆好姿势与机位
      window.__scene.play('arona', 'Idle_01', true)
      for (let i = 0; i < 30; i++) {
        item.state.update(1 / 30)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform(st.core.Physics.update)
      }
      st.fitTo(st.boneBounds('arona'))
      st.drawPremultiplied = drawPremul
    },
    combo
  )
  await page.waitForTimeout(250)
  const url = await page.evaluate(() => window.__scene.snapshot())
  if (!url) {
    console.log(`${combo.label}: 抓帧失败`)
    continue
  }
  const buf = Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64')
  await writeFile(join(OUT, `${combo.label}.png`), buf)
  console.log(`${combo.label}  ${(buf.length / 1024).toFixed(1)}KB`)
}

console.log('\n输出目录:', OUT)
await browser.close()
