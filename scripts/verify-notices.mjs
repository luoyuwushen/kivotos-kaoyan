/**
 * 版权与用途声明的可见性检查。
 *
 * 为什么值得单独一个脚本：这套声明是站点唯一的合规出口 ——
 * 素材是官方/同人的，权利人要求下架时得能在页面上找到联系方式。
 * 声明写在代码里但没显示出来，等于没写，所以这里真的去页面上读一遍。
 *
 *   node scripts/verify-notices.mjs
 */
import { chromium } from 'playwright'
import { installFakeBackend } from './lib/test-session.mjs'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const CONTACT = '2651038380@qq.com'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await installFakeBackend(page)

/* ---------- 1. 页脚（未登录也能看到的那一份） ---------- */
await page.goto(`${BASE}?cb=${Date.now()}#home`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2600)

const foot = (await page.locator('.pagefoot').textContent().catch(() => '')) || ''
check('页脚可见', foot.length > 0)
check('页脚含非商业声明', foot.includes('非商业'), foot.slice(0, 40))
check('页脚含权利归属（Nexon / Yostar）', foot.includes('Nexon') && foot.includes('Yostar'))
check('页脚声明为「非官方粉丝作品」', foot.includes('非官方'))
check('页脚写明使用了官方/同人素材', foot.includes('官方') && foot.includes('同人'))
check('页脚给出侵权联系方式', foot.includes(CONTACT), foot.includes(CONTACT) ? '' : '（没有邮箱）')
check('页脚含 Spine 运行时版权（协议要求）', foot.includes('Esoteric Software'), '')
check('页脚不再声称「不使用官方素材」', !foot.includes('不使用官方'))

/* ---------- 2. 设置页「关于本站」那一份 ---------- */
await page.goto(`${BASE}?cb=${Date.now()}#settings`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3200)
check('已进入设置页', page.url().endsWith('#settings'), page.url())

/**
 * 用 :has-text 而不是 locator(selector, {hasText})：
 * 后者在匹配到多层嵌套的 .card 时会命中多个，strict 模式直接抛错，
 * 被 catch 吞掉之后就变成「找不到」这种误导性的失败。
 */
const aboutCard = page.locator('.card:has-text("用途与版权声明")').first()
const about = (await aboutCard.textContent().catch(() => '')) || ''
const aboutCount = await page.locator('.card:has-text("用途与版权声明")').count()

check('设置页出现「用途与版权声明」', about.includes('用途与版权声明'), `命中 ${aboutCount} 处`)
check('设置页含侵权联系方式', about.includes(CONTACT), about.includes(CONTACT) ? '' : '（没有邮箱）')
check('设置页含 Spine 声明', about.includes('Esoteric Software'))

/* ---------- 3. 站点仍然正常 ---------- */
check('页面没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))
check('主导航仍是 8 项', (await page.locator('.nav-item[data-view]').count()) === 8)

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log('  · ' + f.name)
  process.exitCode = 1
}
