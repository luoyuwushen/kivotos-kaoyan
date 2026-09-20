/**
 * 开发用截图 / 冒烟脚本（不参与部署，仅本地验证）。
 *
 * 用法：
 *   1. npm run preview        # 另开一个终端，起本地预览服务器
 *   2. node scripts/smoke.mjs # 截图 + 收集控制台错误
 *
 * 它会往浏览器里塞一份示例数据，这样截图里能看到"用过一阵子"的样子，
 * 而不是空空如也的初始状态。
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173/'
const OUT = process.env.SMOKE_OUT || 'smoke-shots'
const STORAGE_KEY = 'kivotos-kaoyan-v1'

const VIEWS = ['home', 'quests', 'plan', 'focus', 'mistakes', 'goals', 'medals', 'settings']

/* ---------------- 示例数据 ---------------- */

function d(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function sampleState() {
  const quests = [
    { id: 'q1', date: d(0), title: '高数 第三章 中值定理 + 课后题 1-25', subject: 'math', estMin: 120, done: true, doneAt: new Date().toISOString(), source: 'manual', chapterId: null, createdAt: Date.now() - 9000 },
    { id: 'q2', date: d(0), title: '考研词汇 Unit 12 + 复习 Unit 1-11', subject: 'english', estMin: 45, done: true, doneAt: new Date().toISOString(), source: 'manual', chapterId: null, createdAt: Date.now() - 8000 },
    { id: 'q3', date: d(0), title: '政治 马原 第二章 唯物辩证法', subject: 'politics', estMin: 60, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: Date.now() - 7000 },
    { id: 'q4', date: d(0), title: '英语阅读 2019 Text 1-2 精读', subject: 'english', estMin: 60, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: Date.now() - 6000 },
    { id: 'q5', date: d(0), title: '专业课 参考书一 · 第二章', subject: 'major', estMin: 90, done: false, doneAt: '', source: 'chapter', chapterId: 'c2', createdAt: Date.now() - 5000 },
    { id: 'q6', date: d(0), title: '线性代数 行列式 计算专项', subject: 'math', estMin: 60, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: Date.now() - 4000 },
    { id: 'q7', date: d(-1), title: '概率论 随机变量及其分布', subject: 'math', estMin: 90, done: false, doneAt: '', source: 'manual', chapterId: null, createdAt: Date.now() - 90000 }
  ]

  const focus = []
  for (let i = 0; i < 46; i++) {
    const day = d(-Math.floor(i / 1.6))
    const rounds = (i % 3) + 1
    for (let r = 0; r < rounds; r++) {
      const start = new Date(`${day}T${String(8 + r * 3).padStart(2, '0')}:10:00`).getTime()
      focus.push({
        id: `f${i}-${r}`,
        start,
        end: start + 45 * 60000,
        minutes: 45,
        mode: 'pomodoro',
        subject: ['math', 'english', 'politics', 'major'][(i + r) % 4],
        questId: null
      })
    }
  }

  const chapters = [
    { id: 'c1', subject: 'major', book: '参考书一', title: '第一章 绪论', hours: 8, done: true, order: 0, createdAt: Date.now() },
    { id: 'c2', subject: 'major', book: '参考书一', title: '第二章 基础理论', hours: 8, done: false, order: 1, createdAt: Date.now() },
    { id: 'c3', subject: 'major', book: '参考书一', title: '第三章 核心模型', hours: 12, done: false, order: 2, createdAt: Date.now() },
    { id: 'c4', subject: 'math', book: '高等数学（同济版）上册', title: '第一章 函数与极限', hours: 8, done: true, order: 0, createdAt: Date.now() },
    { id: 'c5', subject: 'math', book: '高等数学（同济版）上册', title: '第二章 导数与微分', hours: 6, done: true, order: 1, createdAt: Date.now() },
    { id: 'c6', subject: 'math', book: '高等数学（同济版）上册', title: '第三章 微分中值定理与导数应用', hours: 8, done: false, order: 2, createdAt: Date.now() }
  ]

  return {
    version: 1,
    profile: {
      nickname: 'Sensei',
      siteName: '基沃托斯作战本部',
      targetSchool: '某某大学',
      targetMajor: '计算机科学与技术',
      examDate: '2027-12-26',
      subjectSet: 'math1',
      dailyGoalMin: 360
    },
    quests,
    phases: [],
    chapters,
    focus,
    mistakes: [
      { id: 'm1', subject: 'math', topic: '中值定理证明题的辅助函数构造', note: '看到 f(a)=f(b) 要先想罗尔，别急着泰勒展开。', level: 'weak', rounds: 1, createdAt: Date.now(), lastReview: d(-1), nextReview: d(0) },
      { id: 'm2', subject: 'math', topic: '定积分换元后上下限忘记同步改', note: '换元必换限，这是送分题失分点。', level: 'ok', rounds: 2, createdAt: Date.now(), lastReview: d(-3), nextReview: d(0) },
      { id: 'm3', subject: 'english', topic: '阅读推理题过度推断', note: '选项里出现原文没提的因果，一律排除。', level: 'ok', rounds: 3, createdAt: Date.now(), lastReview: d(-2), nextReview: d(1) },
      { id: 'm4', subject: 'politics', topic: '马原 矛盾普遍性与特殊性混淆', note: '共性寓于个性之中——记这句就不会错。', level: 'solid', rounds: 4, createdAt: Date.now(), lastReview: d(-5), nextReview: d(2) },
      { id: 'm5', subject: 'major', topic: '第二章 核心模型的适用条件', note: '', level: 'weak', rounds: 0, createdAt: Date.now(), lastReview: '', nextReview: d(0) }
    ],
    goals: [
      { subject: 'math', target: 120, current: 96, full: 150 },
      { subject: 'english', target: 70, current: 61, full: 100 },
      { subject: 'politics', target: 70, current: 58, full: 100 },
      { subject: 'major', target: 120, current: 88, full: 150 }
    ],
    scores: [
      { id: 's1', year: 2026, school: '某某大学', major: '计算机科学与技术', total: 355, lines: { math: 85, english: 55, politics: 55, major: 85 }, note: '复试线，实际录取均分 368' }
    ],
    progress: { streak: 12, bestStreak: 21, lastCheckIn: d(-1), exp: 2480, level: 1 },
    medals: { unlocked: { first_quest: new Date(Date.now() - 86400000 * 12).toISOString(), quest_50: new Date(Date.now() - 86400000 * 6).toISOString(), focus_first: new Date(Date.now() - 86400000 * 11).toISOString(), focus_10h: new Date(Date.now() - 86400000 * 3).toISOString(), streak_3: new Date(Date.now() - 86400000 * 9).toISOString(), streak_7: new Date(Date.now() - 86400000 * 5).toISOString(), chapter_10: new Date(Date.now() - 86400000 * 2).toISOString(), mistake_10: new Date(Date.now() - 86400000).toISOString(), plan_made: new Date(Date.now() - 86400000 * 10).toISOString(), goal_set: new Date(Date.now() - 86400000 * 8).toISOString(), days_300: new Date(Date.now() - 86400000 * 4).toISOString() } },
    settings: {
      theme: 'light',
      mascots: { hoshino: true, arona: true, plana: true, speech: true },
      aiApi: { baseUrl: '', apiKey: '', model: '', enabled: false },
      sync: { gistToken: '', gistId: '' }
    },
    onboarded: true
  }
}

/* ---------------- 主流程 ---------------- */

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const problems = []

  async function shoot(name, { width, height, view, prepare, wait = 900, fullPage = false, onboarded = true }) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
      reducedMotion: 'no-preference'
    })
    const page = await context.newPage()

    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(msg.text())) {
        problems.push(`[console:${name}] ${msg.text()}`)
      }
    })
    page.on('pageerror', (err) => problems.push(`[pageerror:${name}] ${err.message}`))

    // 本机访问不到 Google Fonts，直接拦掉，避免截图卡在"等待字体加载"
    await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
    await page.route('**://fonts.gstatic.com/**', (route) => route.abort())

    // 先把示例数据写进 localStorage，再强制刷新让应用重新读取
    // 注意：goto 只改 hash 不会重载页面，必须显式 reload
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    const seed = sampleState()
    seed.onboarded = onboarded
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify(seed)]
    )
    await page.goto(`${BASE}#${view}`, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(wait)

    if (prepare) await prepare(page)

    // 横向溢出检测
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    if (overflow > 2) problems.push(`[overflow:${name}] 横向溢出 ${overflow}px`)

    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage, timeout: 20000 })
    await context.close()
  }

  // 桌面端：全部视图（视口截图，聚焦首屏）
  for (const view of VIEWS) {
    await shoot(`desktop-${view}`, { width: 1440, height: 1000, view })
  }

  // 首页长图（看完整 Bento 排布）
  await shoot('desktop-home-full', { width: 1440, height: 1000, view: 'home', fullPage: true, wait: 1200 })

  // 平板
  await shoot('tablet-home', { width: 834, height: 1112, view: 'home' })
  await shoot('tablet-plan', { width: 834, height: 1112, view: 'plan' })

  // 手机
  for (const view of ['home', 'quests', 'focus', 'medals']) {
    await shoot(`mobile-${view}`, { width: 390, height: 844, view })
  }

  // 首次打开引导（只有这一张打开 onboarded）
  await shoot('desktop-welcome', { width: 1440, height: 1000, view: 'home', onboarded: false, wait: 1800 })

  // 深色模式
  await shoot('desktop-dark-home', {
    width: 1440,
    height: 1000,
    view: 'home',
    prepare: async (page) => {
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark'
      })
      await page.waitForTimeout(400)
    }
  })

  await browser.close()

  console.log('\n=== 截图完成 ===')
  console.log(`输出目录: ${OUT}`)
  if (problems.length) {
    console.log(`\n=== 发现 ${problems.length} 个问题 ===`)
    for (const p of [...new Set(problems)]) console.log(' - ' + p)
    process.exitCode = 1
  } else {
    console.log('没有控制台错误、没有横向溢出。')
  }
}

main().catch((err) => {
  console.error('冒烟脚本失败：', err)
  process.exit(1)
})
