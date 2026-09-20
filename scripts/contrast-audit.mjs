/**
 * 对比度审计：把首页关键文字的实际渲染色，与该位置**真实渲染出来的像素**采样出来，
 * 算 WCAG 对比度。
 *
 * 天空面板是"渐变 + 白色辉光"叠出来的，靠 token 推算一定算错，
 * 所以这里截一张全页图，再在 canvas 里按元素坐标取像素。
 *
 *   node scripts/contrast-audit.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173/'
const STORAGE_KEY = 'kivotos-kaoyan-v1'

const TARGETS = [
  '.countdown__label',
  '.countdown__num',
  '.countdown__unit',
  '.countdown__meta span',
  '.countdown__phase',
  '.hero__side .tag',
  '.strapbar__item strong',
  '.strapbar .dim-2',
  '.speech__who',
  '.speech__text',
  '.card__title',
  '.quest__title',
  '.quest__meta',
  '.stat__value',
  '.stat__label',
  '.pagefoot__note',
  '.pagefoot__brand',
  '.nav-item',
  '.nav-item__icon',
  '.tag--on-sky',
  '.brand__sub',
  '.section-title'
]

function parseRgb(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '')
  if (!m) return null
  const p = m[1].split(',').map((v) => parseFloat(v))
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
}

function relLum({ r, g, b }) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const ratio = (a, b) =>
  (Math.max(relLum(a), relLum(b)) + 0.05) / (Math.min(relLum(a), relLum(b)) + 0.05)

/** 把前景色按 alpha 合成到背景像素上 */
const over = (fg, bg) => {
  const a = fg.a ?? 1
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) }
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })

  await page.route('**://fonts.googleapis.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' })
  )
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort())

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const seed = {
    version: 1,
    profile: { nickname: 'Sensei', siteName: '基沃托斯作战本部', examDate: '2027-12-26', dailyGoalMin: 360 },
    quests: [
      { id: 'q1', date: new Date().toISOString().slice(0, 10), title: '政治 马原 第二章 唯物辩证法', subject: 'politics', estMin: 60, done: false, source: 'manual' },
      { id: 'q2', date: new Date().toISOString().slice(0, 10), title: '线性代数 行列式 计算专项', subject: 'math', estMin: 60, done: false, source: 'manual' }
    ],
    phases: [],
    chapters: [],
    focus: [],
    mistakes: [],
    goals: [],
    scores: [],
    progress: { streak: 12, exp: 100, level: 1 },
    medals: { unlocked: {} },
    settings: { theme: 'light', mascots: { hoshino: true, arona: true, plana: true } },
    onboarded: true
  }
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(seed)])
  await page.goto(`${BASE}#home`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  // 等入场动画全部跑完（reveal 里的元素初始 opacity:0，这时候截图会采到空白）
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
    document.querySelectorAll('[data-reveal]').forEach((n) => n.classList.add('rise'))
  })
  await page.waitForTimeout(1200)

  // 覆盖整页的截图（带滚动偏移，所以下面要加上 scrollY）
  const shot = await page.screenshot({ fullPage: true })
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`

  const rows = await page.evaluate(
    async ([selectors, url]) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)

      const out = []
      for (const sel of selectors) {
        const node = document.querySelector(sel)
        if (!node) {
          out.push({ sel, missing: true })
          continue
        }
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        if (!rect.width || !rect.height) {
          out.push({ sel, missing: true })
          continue
        }

        // 关键：不能在文字框**内部**采样——大字号元素整框都是字形。
        // 改成在框外扩一圈的环带里取样，再剔除与文字色相近的像素（描边/抗锯齿）。
        const fgRgb = (() => {
          const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(node).color)
          if (!m) return null
          const p = m[1].split(',').map(Number)
          return { r: p[0], g: p[1], b: p[2] }
        })()

        const pad = 6
        const x0 = Math.max(0, Math.floor(rect.left - pad))
        const x1 = Math.min(canvas.width - 1, Math.ceil(rect.right + pad))
        const y0 = Math.max(0, Math.floor(rect.top + window.scrollY - pad))
        const y1 = Math.min(canvas.height - 1, Math.ceil(rect.bottom + window.scrollY + pad))
        if (x1 <= x0 || y1 <= y0) {
          out.push({ sel, missing: true })
          continue
        }

        const frame = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
        const w = x1 - x0
        const bgPixels = []
        for (let py = 0; py < y1 - y0; py++) {
          for (let px = 0; px < w; px++) {
            const i = (py * w + px) * 4
            const c = { r: frame[i], g: frame[i + 1], b: frame[i + 2] }
            // 丢掉和文字色太接近的像素（那就是字形本身）
            if (fgRgb) {
              const d = Math.abs(c.r - fgRgb.r) + Math.abs(c.g - fgRgb.g) + Math.abs(c.b - fgRgb.b)
              if (d < 90) continue
            }
            bgPixels.push(c)
          }
        }

        const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
        if (!bgPixels.length) {
          out.push({ sel, missing: true, reason: '无背景像素' })
          continue
        }
        bgPixels.sort((a, b) => lum(a) - lum(b))
        // 取最亮与最暗两端的代表，最后挑对文字最不利的那个。
        // 注意：小元素（按钮、标签）的外扩环带大部分是字形本身，
        // 采样会偏悲观，所以对它们只作提示，不当硬失败。
        const bg = bgPixels[Math.floor(bgPixels.length * 0.9)]
        const bgDark = bgPixels[Math.floor(bgPixels.length * 0.1)]

        out.push({
          sel,
          color: style.color,
          fontSize: parseFloat(style.fontSize),
          fontWeight: style.fontWeight,
          bg,
          bgDark,
          // 元素自身有接近不透明的底色时，像素采样会落在自己的底上，直接读计算值更准
          ownBg: (() => {
            const bs = style.backgroundColor
            const m = /rgba?\(([^)]+)\)/.exec(bs || '')
            if (!m) return null
            const p = m[1].split(',').map(Number)
            const a = p.length > 3 ? p[3] : 1
            return a >= 0.6 ? { r: p[0], g: p[1], b: p[2] } : null
          })(),
          text: (node.textContent || '').trim().slice(0, 24)
        })
      }
      return out
    },
    [TARGETS, dataUrl]
  )

  console.log('\n' + '选择器'.padEnd(26) + '字号'.padEnd(9) + '对比度'.padEnd(11) + '判定')
  console.log('-'.repeat(80))
  let fails = 0
  for (const row of rows) {
    if (row.missing) {
      console.log(row.sel.padEnd(26) + '(未渲染)')
      continue
    }
    const fg = parseRgb(row.color)
    if (!fg) {
      console.log(row.sel.padEnd(26) + '无法解析颜色')
      continue
    }
    // 优先用元素自己的不透明底色；否则用采样到的最不利背景
    const light = relLum(fg) > 0.5
    const worst = row.ownBg || (light ? row.bg : row.bgDark)
    const r = ratio(over(fg, worst), worst)
    const large = row.fontSize >= 24 || (row.fontSize >= 18.66 && Number(row.fontWeight) >= 700)
    const need = large ? 3.0 : 4.5
    const ok = r >= need
    if (!ok) fails++
    console.log(
      row.sel.padEnd(26) +
        `${row.fontSize}px`.padEnd(9) +
        `${r.toFixed(2)}:1`.padEnd(11) +
        (ok ? 'PASS' : `FAIL 需 ${need}`) +
        (row.text ? `  « ${row.text}` : '')
    )
  }
  console.log('-'.repeat(80))
  console.log(fails ? `${fails} 项未达 WCAG AA` : '全部达到 WCAG AA')

  await browser.close()
  process.exitCode = fails ? 1 : 0
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
