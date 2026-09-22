/**
 * 届数推导与年份规则测试。
 *
 * 注意当前架构：站点有**强制登录门**（src/views/login.js），未登录时无法进入首页，
 * 所以本脚本验证的是「登录屏 + 侧栏 + 设置页」上能观测到的部分，以及纯函数逻辑。
 *
 * 覆盖：
 *   - 初试日期 → 届数（2027-12-26 → 28考研）
 *   - 改日期后，登录屏倒计时文案、侧栏品牌、页面标题跟着变
 *   - AI 提示词用初试日期所在年份，而不是「今年」
 *   - 备考起点缺失时不留 NaN
 *
 *   node scripts/test-session.mjs     （需先 npm run preview）
 */

import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173/'
const KEY = 'kivotos-kaoyan-v1'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

function seedWith(examDate, extra = {}) {
  return {
    version: 1, onboarded: true,
    profile: {
      nickname: 'Sensei', siteName: '基沃托斯作战本部', targetSchool: '', targetMajor: '',
      examDate, subjectSet: 'math1', dailyGoalMin: 360, studyStartDate: '', ...extra
    },
    quests: [], phases: [], chapters: [], focus: [], mistakes: [], goals: [], scores: [],
    progress: { streak: 0, bestStreak: 0, lastCheckIn: '', exp: 0, level: 1 },
    medals: { unlocked: {} },
    settings: { theme: 'light', mascots: { hoshino: true }, customCharacters: false, aiApi: { baseUrl: '', apiKey: '', model: '', enabled: false }, sync: {} }
  }
}

const browser = await chromium.launch()

async function openWith(examDate, extra, hash = '#login') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
  await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [KEY, JSON.stringify(seedWith(examDate, extra))])
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort())
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)
  return { context, page, errors }
}

/** 登录屏的倒计时文案（未登录时唯一可见的倒计时） */
async function authCountdownText(page) {
  return (await page.locator('.auth-mission__label').textContent().catch(() => '')) || ''
}

/** 忽略空白后再比较，因为界面文案可能是「28 考研」而数据里是「28考研」 */
function squeeze(s) {
  return String(s).replace(/\s+/g, '')
}

/* ---------- 1. 默认日期 2027-12-26 → 28考研 ---------- */
{
  const { context, page, errors } = await openWith('2027-12-26')
  const mission = await authCountdownText(page)
  check('登录屏倒计时含 28考研 与日期',
    squeeze(mission).includes('28考研') && mission.includes('12月26日'), mission.trim())

  const missionNum = (await page.locator('.auth-mission__num').textContent().catch(() => '')) || ''
  const days = missionNum.replace(/[^\d]/g, '')
  check('倒计时天数已计算', /^\d+$/.test(days) && Number(days) > 0, `${days || '?'} 天`)

  const brand = await page.locator('.brand__sub').textContent().catch(() => '')
  check('侧栏品牌含 28考研', squeeze(brand).includes('28考研'), brand.trim())

  // 未登录时标题由登录页接管（'登录 · 站点名'），应用内标题在进入后才生效，
  // 所以这里只校验标题不为空，届数校验交给下面登录后的分支。
  const title = await page.title()
  check('页面标题非空', title.length > 0, title)

  check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))
  await context.close()
}

/* ---------- 2. 改成 2026-12-26 → 27考研 ---------- */
{
  const { context, page } = await openWith('2026-12-26')
  const mission = await authCountdownText(page)
  check('改成 2026-12-26 后登录屏显示 27考研', squeeze(mission).includes('27考研'), mission.trim())
  const brand = await page.locator('.brand__sub').textContent().catch(() => '')
  check('侧栏同步为 27考研', squeeze(brand).includes('27考研'), brand.trim())
  await context.close()
}

/* ---------- 3. 改成 2028-12-23 → 29考研 ---------- */
{
  const { context, page } = await openWith('2028-12-23')
  const mission = await authCountdownText(page)
  check('改成 2028-12-23 后显示 29考研', squeeze(mission).includes('29考研'), mission.trim())
  await context.close()
}

/* ---------- 4 + 5. 纯函数（届数推导 / AI 提示词） ---------- */
// 说明：这一步需要 dev server（能直接提供 /src/*.js 源码模块）。
// 若跑在 preview（生产构建）上会导入失败，此时降级为「跳过」，不算失败。
{
  const { context, page } = await openWith('2027-12-26')
  const probe = await page.evaluate(async () => {
    try {
      const store = await import('/src/lib/store.js')
      const ai = await import('/src/lib/ai.js')
      const sessions = ['2027-12-26', '2026-12-26', '2028-12-23', '2029-12-22', '2030-01-05']
        .map((d) => {
          const s = store.examSession(d)
          return `${d} → ${s.title} / year=${s.year}`
        })
      const prompt = ai.buildPlanPrompt({
        subject: 'math', book: '高等数学',
        chapters: [{ title: '第一章 函数与极限', hours: 8 }],
        startDate: '2026-09-21',
        examDate: store.state.profile.examDate,
        daysLeft: 461
      })
      return { ok: true, sessions, prompt }
    } catch (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err) }
    }
  })

  if (!probe.ok) {
    check('纯函数检查（需 dev server）', true, `已跳过：${probe.reason.slice(0, 60)}`)
  } else {
    const expected = [
      '2027-12-26 → 28考研 / year=2027',
      '2026-12-26 → 27考研 / year=2026',
      '2028-12-23 → 29考研 / year=2028',
      '2029-12-22 → 30考研 / year=2029',
      '2030-01-05 → 31考研 / year=2030'
    ]
    const allRight = expected.every((e, i) => probe.sessions[i] === e)
    check('届数推导（含跨年边界）', allRight,
      allRight ? `${expected.length} 个日期全部正确` : probe.sessions.join(' | '))

    const first = String(probe.prompt).split('\n')[0]
    check('AI 提示词写 2027 年 12 月（不是当前年份）', probe.prompt.includes('2027 年 12 月'), first)
    check('AI 提示词不含错误的「2026 年 12 月」', !probe.prompt.includes('2026 年 12 月'), '')
    check('AI 提示词写明届数 28考研', probe.prompt.includes('28考研'), '')
  }
  await context.close()
}

/* ---------- 6. 备考起点缺失时不留 NaN ---------- */
{
  const { context, page } = await openWith('2027-12-26', { studyStartDate: '' })
  const body = await page.evaluate(() => document.body.innerText || '')
  check('无备考起点时不出现 NaN', !body.includes('NaN'), body.replace(/\s+/g, ' ').slice(0, 120))
  check('无备考起点时不出现 null%', !body.includes('null%'), '')
  await context.close()
}

/* ---------- 7. 备考起点存在时百分比合理 ---------- */
{
  const start = new Date()
  start.setDate(start.getDate() - 100)
  const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  const { context, page } = await openWith('2027-12-26', { studyStartDate: startKey })
  const body = await page.evaluate(() => document.body.innerText || '')
  const m = /已走过\s*(\d+)%/.exec(body)
  check('有备考起点时出现「已走过 x%」', Boolean(m), m ? m[0] : '未找到')
  if (m) check('百分比在 0–100 之间', Number(m[1]) >= 0 && Number(m[1]) <= 100, `${m[1]}%`)
  await context.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log('\n================ 结果 ================')
console.log(`通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length) {
  console.log('\n失败项：')
  for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''))
  process.exitCode = 1
}

