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

      const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

      /*
       * 天空面板的背景是渐变 + 辉光叠出来的，靠 token 推算一定算错。
       * 但"逐元素在周围取像素"也不可靠——文字和背景在同一像素上分不开。
       * 所以：先沿面板最左侧一条**确定没有文字**的竖条，取出一条背景亮度剖面，
       * 后面所有面板内的文字，都按它自己的纵向位置去查这条剖面。
       */
      const panel = document.querySelector('.sky-panel')
      let profile = null
      if (panel) {
        const pr = panel.getBoundingClientRect()
        const stripX = Math.round(pr.left + 4) // 左内边距里，一定没有正文
        const strip = ctx.getImageData(
          stripX,
          Math.round(pr.top + window.scrollY),
          1,
          Math.round(pr.height)
        ).data
        profile = { top: pr.top + window.scrollY, height: pr.height, data: strip }
      }
      const skyAt = (clientY) => {
        if (!profile) return null
        const y = Math.round(clientY + window.scrollY - profile.top)
        const i = Math.max(0, Math.min(profile.height - 1, y)) * 4
        return { r: profile.data[i], g: profile.data[i + 1], b: profile.data[i + 2] }
      }

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

        const fgRgb = (() => {
          const m = /rgba?\(([^)]+)\)/.exec(style.color)
          if (!m) return null
          const p = m[1].split(',').map(Number)
          return { r: p[0], g: p[1], b: p[2] }
        })()

        // 元素自己的底色（含半透明）。取不到就往上找最近的、有可见底色的祖先
        // ——".countdown__meta span" 自己没有底，底在父级那个贴片上。
        const ownBg = (() => {
          const read = (str) => {
            const m = /rgba?\(([^)]+)\)/.exec(str || '')
            if (!m) return null
            const p = m[1].split(',').map(Number)
            return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
          }
          const fromRules = (elm) => {
            let found = null
            for (const sheet of document.styleSheets) {
              let rules
              try {
                rules = sheet.cssRules
              } catch {
                continue
              }
              for (const rule of rules || []) {
                if (!rule.selectorText || !rule.style) continue
                let hit = false
                try {
                  hit = elm.matches(rule.selectorText)
                } catch {
                  hit = false
                }
                if (!hit) continue
                const cand =
                  read(rule.style.getPropertyValue('background-color')) ||
                  read(rule.style.getPropertyValue('background'))
                if (cand && cand.a > 0.05) found = cand
              }
            }
            return found
          }

          let elm = node
          let c = null
          while (elm && elm !== document.documentElement) {
            // 到天空面板就停：天色画在 ::before 上，getComputedStyle 读不到。
            // 注意只在"已经上行到面板本身"时停，起始节点自己在面板里不算。
            if (elm !== node && elm.classList?.contains('sky-panel')) break
            const own = read(getComputedStyle(elm).backgroundColor)
            c = own && own.a > 0.05 ? own : fromRules(elm)
            if (c) break
            elm = elm.parentElement
          }
          if (!c) return null
          const under = skyAt(rect.top + rect.height / 2) || { r: 255, g: 255, b: 255 }
          if (c.a >= 0.99) return { r: c.r, g: c.g, b: c.b }
          return {
            r: c.r * c.a + under.r * (1 - c.a),
            g: c.g * c.a + under.g * (1 - c.a),
            b: c.b * c.a + under.b * (1 - c.a)
          }
        })()

        const inPanel = Boolean(node.closest('.sky-panel'))
        const sky = inPanel ? skyAt(rect.top + rect.height / 2) : null

        out.push({
          sel,
          color: style.color,
          fontSize: parseFloat(style.fontSize),
          fontWeight: style.fontWeight,
          ownBg,
          sky,
          skyLum: sky ? +lum(sky).toFixed(1) : null,
          panelT: profile
            ? ((rect.top + rect.height / 2 + window.scrollY - profile.top) / profile.height) * 100
            : null,
          fallbackBg: { r: 255, g: 255, b: 255 },
          text: (node.textContent || '').trim().slice(0, 24)
        })
      }
      return out
    },
    [TARGETS, dataUrl]
  )

  console.log('\n' + '选择器'.padEnd(24) + '字号'.padEnd(9) + '对比度'.padEnd(11) + '判定'.padEnd(14) + '天色位置')
  console.log('-'.repeat(96))
  let fails = 0
  for (const row of rows) {
    if (row.missing) {
      console.log(row.sel.padEnd(24) + '(未渲染)')
      continue
    }
    const fg = parseRgb(row.color)
    if (!fg) {
      console.log(row.sel.padEnd(24) + '无法解析颜色')
      continue
    }
    const dbg = process.env.AUDIT_DEBUG && (row.sel.includes('meta') || row.sel.includes('phase'))
    if (dbg) console.log('   [debug]', row.sel, 'ownBg=', JSON.stringify(row.ownBg), 'sky=', JSON.stringify(row.sky))
    // 背景优先级：元素自己的底色（半透明按天色剖面合成）> 天色剖面 > 白底
    const worst = row.ownBg || row.sky || row.fallbackBg
    const r = ratio(over(fg, worst), worst)
    const large = row.fontSize >= 24 || (row.fontSize >= 18.66 && Number(row.fontWeight) >= 700)
    const need = large ? 3.0 : 4.5
    const ok = r >= need
    if (!ok) fails++
    const where =
      row.panelT != null
        ? `天色 ${row.panelT.toFixed(0)}% · 亮度 ${row.skyLum}`
        : ''
    console.log(
      row.sel.padEnd(24) +
        `${row.fontSize}px`.padEnd(9) +
        `${r.toFixed(2)}:1`.padEnd(11) +
        (ok ? 'PASS' : `FAIL 需 ${need}`).padEnd(14) +
        where
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
