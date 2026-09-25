/**
 * 线上「设计落地」验证：确认发布出去的确实是我们验证过的那套视觉。
 * 运行时没报错 ≠ 样式上对了 —— 上一版就出现过「白字落在浅色天上、只有 1.35:1」
 * 这种不报错但看不清的问题，所以这里逐条断言 DESIGN.md 里的关键 Token。
 *
 *   node scripts/verify-live-design.mjs
 *   TARGET=http://127.0.0.1:4173/ node scripts/verify-live-design.mjs   # 也能验本地
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// 造一份「已登录」的会话，否则站点会把人拦在登录屏，站内视觉一项都量不到
import { installFakeBackend } from './lib/test-session.mjs'

const BASE = process.env.TARGET || 'https://luoyuwushen.github.io/kivotos-kaoyan/'
const OUT = process.env.OUT || join(tmpdir(), 'kaoyan-verify-design')
const KEY = 'kivotos-kaoyan-v1'

const EXPECT = {
  accent: 'rgb(17, 137, 249)', // #1189F9 官方站实测主色
  accentHex: '#1189f9',
  cardBorder: '2px',
  darkBg: 'rgb(15, 28, 43)'
}

const seed = {
  version: 1,
  profile: { nickname: 'Sensei', siteName: '基沃托斯作战本部', examDate: '2027-12-26', dailyGoalMin: 360 },
  quests: [
    { id: 'q1', date: new Date().toISOString().slice(0, 10), title: '高数 第三章 中值定理', subject: 'math', estMin: 90, done: true, source: 'manual' },
    { id: 'q2', date: new Date().toISOString().slice(0, 10), title: '英语阅读 精读', subject: 'english', estMin: 60, done: false, source: 'manual' }
  ],
  phases: [],
  chapters: [],
  focus: [],
  mistakes: [],
  goals: [{ subject: 'math', target: 120, current: 96, full: 150 }],
  scores: [],
  progress: { streak: 9, exp: 1200, level: 3 },
  medals: { unlocked: {} },
  settings: { theme: 'light', mascots: { hoshino: true, arona: true, plana: true }, customCharacters: false },
  onboarded: true
}

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, locale: 'zh-CN' })
await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [KEY, JSON.stringify(seed)])

const page = await context.newPage()
await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://fonts.gstatic.com/**', (r) => r.abort())
/**
 * 站点配了后端之后，**没登录会被登录屏挡在门外**（首屏就是 #login），
 * 而这份脚本要逐页量天空面板、卡片、导航这些站内视觉 —— 没有会话就一项都量不到
 * （表现是「通过 25/49」，看着像设计坏了，其实是被门禁拦住了）。
 * 所以先装一份假会话：只造会话、不验同步，同步协议由 test-cloud.mjs 专门验。
 */
await installFakeBackend(page)

const failed = []
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })

await page.goto(`${BASE}#home`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2200)

/* ---------- 1. 拉取线上 CSS，检查 token 定义 ---------- */
// 注意：首屏有两个 stylesheet —— 第一个是 Google Fonts，必须挑站点自己那个，
// 否则会去字体 CSS 里找颜色，永远找不到。
const cssHref = await page.evaluate(() => {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')]
  const own = links.find((l) => /\/assets\/.*\.css/.test(l.href))
  return own ? own.href : null
})
if (!cssHref) failed.push('找不到站点自己的样式表链接')
let cssText = ''
if (cssHref) {
  const res = await page.request.get(cssHref)
  cssText = await res.text()
}
// 压缩后 hex 可能被写成大写，比较时统一小写
const cssLower = cssText.toLowerCase()
check('能取到站点自己的样式表', /\/assets\/.*\.css/.test(cssHref || ''), String(cssHref))
check('线上 CSS 含主色 token #1189f9', cssLower.includes(EXPECT.accentHex))
check('线上 CSS 含天顶色 token #1d5c9e', cssLower.includes('#1d5c9e'))
check('线上 CSS 含辉光色 token #a7d8ea', cssLower.includes('#a7d8ea'))
check('线上 CSS 未残留旧主色 #3d9be9', !cssLower.includes('#3d9be9'))
check('线上 CSS 中文注释未损坏', !cssText.includes('\uFFFD'), '出现替换字符 U+FFFD')
void cssHref

/* ---------- 2. 计算样式断言 ---------- */
const style = await page.evaluate(() => {
  const cs = (sel, prop, pseudo) => {
    const n = document.querySelector(sel)
    return n ? getComputedStyle(n, pseudo || null)[prop] : null
  }
  const sky = document.querySelector('.sky-panel')
  const halo = document.querySelector('.halo')

  // 卡片身份色是"自定义属性"，getComputedStyle(el)['--x'] 取不到。
  // 用一个探针 div 套上各 tone 类，读它实际算出来的颜色（会解析 var 链）。
  const toneColor = (cls) => {
    const probe = document.createElement('div')
    probe.className = `card ${cls}`
    probe.style.cssText = 'position:absolute;left:-9999px;top:0'
    const bar = document.createElement('div')
    bar.className = 'card__head'
    probe.append(bar)
    document.body.append(probe)
    const before = getComputedStyle(bar, '::before')
    const color = before.backgroundColor
    probe.remove()
    return color
  }

  return {
    accentOnNav: cs('.nav-item[aria-current="page"]', 'backgroundColor'),
    cardBorder: cs('.card', 'borderTopWidth'),
    // 要读"带边框"的那种卡片；.card--flat 是刻意不要边框阴影的次级卡
    cardShadow: cs('.card--spot', 'boxShadow') || '',
    skyExists: Boolean(sky),
    skyGradient: sky ? getComputedStyle(sky, '::before').backgroundImage : '',
    skyCloud: sky ? getComputedStyle(sky, '::after').backgroundImage : '',
    skyRadius: sky ? getComputedStyle(sky).borderRadius : null,
    haloTransform: halo ? getComputedStyle(halo).transform : null,
    haloGapGradient: halo ? getComputedStyle(halo, '::before').backgroundImage : '',
    bgLayers: document.querySelectorAll('.bg-layer > *').length,
    rayCount: document.querySelectorAll('.bg-ray').length,
    hatchExists: Boolean(document.querySelector('.bg-hatch')),
    cloudExists: Boolean(document.querySelector('.bg-cloud')),
    strapbar: Boolean(document.querySelector('.strapbar')),
    strapItems: document.querySelectorAll('.strapbar__item').length,
    straps: document.querySelectorAll('.strapbar .strap').length,
    countdownFontSize: cs('.countdown__num', 'fontSize'),
    countdownColor: cs('.countdown__num', 'color'),
    metaChipBg: cs('.countdown__meta', 'backgroundColor'),
    pagefoot: Boolean(document.querySelector('.pagefoot')),
    sidenavNotice: (document.querySelector('.sidenav')?.textContent || '').includes('非商业'),
    toneCounts: {
      quest: document.querySelectorAll('.tone-quest').length,
      focus: document.querySelectorAll('.tone-focus').length,
      goal: document.querySelectorAll('.tone-goal').length
    },
    toneQuest: toneColor('tone-quest'),
    toneFocus: toneColor('tone-focus'),
    toneGoal: toneColor('tone-goal'),
    tabularNums: cs('.countdown__num', 'fontVariantNumeric')
  }
})

check('导航活跃态用官方站主色', style.accentOnNav === EXPECT.accent, `实际 ${style.accentOnNav}`)
check('卡片边框 2px（官方站口径）', style.cardBorder === EXPECT.cardBorder, `实际 ${style.cardBorder}`)
check('卡片用三层叠边（含 inset）而非硬投影', style.cardShadow.includes('inset'), style.cardShadow.slice(0, 70))
check('天空面板存在', style.skyExists)
check('天色渐变生效', style.skyGradient.includes('gradient'), style.skyGradient.slice(0, 50))
check('地平线云带生效', style.skyCloud.includes('gradient'))
check('天空面板圆角为 28px', style.skyRadius === '28px', String(style.skyRadius))

check('光环被透视压扁（transform 是矩阵）', /matrix/.test(style.haloTransform || ''), String(style.haloTransform))
check('光环是 conic 断口环带', style.haloGapGradient.includes('conic'), style.haloGapGradient.slice(0, 50))

check('氛围层已铺开（≥8 层）', style.bgLayers >= 8, `${style.bgLayers} 层`)
check('斜射光柱 3 条', style.rayCount === 3, String(style.rayCount))
check('细密网格纹理存在', style.hatchExists)
check('页脚云带存在', style.cloudExists)

check('倒计时是巨型字号（≥76px）', parseFloat(style.countdownFontSize) >= 76, style.countdownFontSize)
check('倒计时是纯白', style.countdownColor === 'rgb(255, 255, 255)', style.countdownColor)
check('小字带深色贴片（不是裸白字）', /rgba?\(/.test(style.metaChipBg || ''), String(style.metaChipBg))
check('数字用 tabular-nums', String(style.tabularNums).includes('tabular'), String(style.tabularNums))

check('作战状态条存在', style.strapbar)
check('状态条有 4 项', style.strapItems === 4, String(style.strapItems))
check('状态条用斜杠饰带分隔', style.straps === 3, String(style.straps))

check('页脚已独立成条', style.pagefoot)
check('侧栏不再塞版权声明', style.sidenavNotice === false, '侧栏里仍有声明')

check('卡片身份色：委托=蓝', style.toneQuest === EXPECT.accent, String(style.toneQuest))
check('卡片身份色：专注=天蓝', style.toneFocus === 'rgb(91, 200, 245)', String(style.toneFocus))
check('卡片身份色：目标=粉', style.toneGoal === 'rgb(242, 160, 191)', String(style.toneGoal))
check(
  '首页三类身份色卡片都已挂上',
  style.toneCounts.quest >= 1 && style.toneCounts.focus >= 1 && style.toneCounts.goal >= 1,
  JSON.stringify(style.toneCounts)
)

check('无资源 404', failed.length === 0, failed.slice(0, 2).join(' | '))

await mkdir(OUT, { recursive: true })
await page.screenshot({ path: join(OUT, 'live-desktop-home.png'), fullPage: true })

/* ---------- 3. 深色模式 ---------- */
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
await page.waitForTimeout(600)
const dark = await page.evaluate(() => {
  const sky = document.querySelector('.sky-panel')
  return {
    bodyBg: getComputedStyle(document.body).backgroundColor,
    sky1: getComputedStyle(document.documentElement).getPropertyValue('--sky-1').trim(),
    strapBg: getComputedStyle(document.documentElement).getPropertyValue('--strap-bg').trim()
  }
})
check('深色模式底色正确', dark.bodyBg === EXPECT.darkBg, dark.bodyBg)
check('深色下天顶色独立', dark.sky1 === '#0b2d4d', dark.sky1)
check('深色下状态条底色收窄', /,\s*\.?0?\.1\)/.test(dark.strapBg), dark.strapBg)
await page.screenshot({ path: join(OUT, 'live-desktop-dark.png') })

/* ---------- 4. 移动端 ---------- */
await page.setViewportSize({ width: 390, height: 844 })
await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
await page.waitForTimeout(700)
const mob = await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item[data-view]')
  let minH = Infinity
  items.forEach((n) => { minH = Math.min(minH, n.getBoundingClientRect().height) })
  return {
    navPos: getComputedStyle(document.querySelector('.sidenav')).position,
    count: items.length,
    minTouch: minH,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    haloHidden: getComputedStyle(document.querySelector('.halo')).display,
    giantText: document.querySelectorAll('.countdown__num').length
  }
})
check('手机端导航固定到底部', mob.navPos === 'fixed', mob.navPos)
check('手机端 8 个标签', mob.count === 8, String(mob.count))
check('触摸目标 ≥ 44px', mob.minTouch >= 44, `${mob.minTouch.toFixed(1)}px`)
check('手机端无横向溢出', mob.overflow <= 2, `${mob.overflow}px`)
check('手机端省掉常驻光环动画', mob.haloHidden === 'none', mob.haloHidden)
await page.screenshot({ path: join(OUT, 'live-mobile-home.png') })

/* ---------- 5. 云端同步卡片（路径 2）----------
   线上站点是「使用者自己填项目」，所以这里应该看到配置引导，
   而且状态徽标的配色必须走 DESIGN.md 的 token，不能是随手写的颜色。 */
await page.setViewportSize({ width: 1440, height: 1000 })
await page.emulateMedia({ media: 'screen' })
await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const cloud = await page.evaluate(() => {
  const card = [...document.querySelectorAll('main section.card')].find((s) =>
    s.textContent.includes('云端同步')
  )
  const status = card?.querySelector('.cloud-status')
  const dot = status?.querySelector('.cloud-status__dot')
  const cs = status ? getComputedStyle(status) : null
  const dcs = dot ? getComputedStyle(dot) : null
  return {
    hasCard: Boolean(card),
    hasStatus: Boolean(status),
    state: status?.dataset.state || '',
    dotColor: dcs?.backgroundColor || '',
    dotRadius: dcs?.borderRadius || '',
    borderWidth: cs?.borderTopWidth || '',
    // 三种界面状态：① 还没配置（本机构建带 .env.local 时不会有）
    //              ② 配置了、未登录 → 登录表单  ③ 已登录 → 账号面板
    configForm: Boolean(card?.querySelector('[data-testid="cloud-config-form"]')),
    loginForm: Boolean(card?.querySelector('[data-testid="cloud-login"]')),
    accountPanel: Boolean(card?.querySelector('[data-testid="cloud-account"]')),
    guideButton: /怎么申请/.test(card?.textContent || ''),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }
})
/** 已经配过（构建期烘焙或本机存过）时，界面就不该再给配置表单 */
const alreadyConfigured = cloud.loginForm || cloud.accountPanel

check('设置页有「云端同步」卡片', cloud.hasCard)
check('云端状态徽标已渲染', cloud.hasStatus && cloud.dotColor !== '', `${cloud.state} / ${cloud.dotColor}`)
check('状态圆点是圆形（半径 50%）', cloud.dotRadius === '50%', cloud.dotRadius)
check('状态徽标走 token 边框（1px）', cloud.borderWidth === '1px', cloud.borderWidth)
check('设置页在配置缺失时无横向溢出', cloud.overflow <= 2, `${cloud.overflow}px`)
if (alreadyConfigured) {
  check('已配置时进入登录/账号流程（不再要求填项目）',
    cloud.loginForm || cloud.accountPanel,
    cloud.accountPanel ? '账号面板' : '登录表单')
} else {
  check('未配置时给出项目配置表单', cloud.configForm, cloud.configForm ? '' : '没看到 cloud-config-form')
  check('未配置时给出「怎么申请」引导', cloud.guideButton)
}
await page.screenshot({ path: join(OUT, 'live-settings-cloud.png') })

/* ---------- 6. 打印样式不该崩 ---------- */
await page.setViewportSize({ width: 1440, height: 1000 })
await page.emulateMedia({ media: 'print' })
await page.waitForTimeout(300)
const printOk = await page.evaluate(() => {
  const btn = document.querySelector('.btn')
  return { btnHidden: btn ? getComputedStyle(btn).display === 'none' : true }
})
check('打印时按钮隐藏', printOk.btnHidden)
await page.emulateMedia({ media: 'screen' })

await browser.close()

/* ---------- 汇总 ---------- */
console.log('\n============ 线上设计落地验证 ============')
console.log(`URL: ${BASE}`)
console.log('')
let fails = 0
for (const r of results) {
  if (!r.ok) fails++
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${!r.ok && r.detail ? '  → ' + r.detail : ''}`)
}
console.log('')
console.log(`通过 ${results.length - fails} / ${results.length}`)
console.log(`截图：${OUT}`)
if (fails) process.exitCode = 1
