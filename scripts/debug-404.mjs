import { chromium } from 'playwright'

const URL_TO_TEST = process.env.TARGET || 'https://luoyuwushen.github.io/kivotos-kaoyan/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

const failed = []
page.on('response', (res) => {
  if (res.status() >= 400) failed.push(`${res.status()} ${res.request().resourceType()} ${res.url()}`)
})
page.on('requestfailed', (req) => failed.push(`FAILED ${req.resourceType()} ${req.url()} :: ${req.failure()?.errorText}`))

// 在页面里挂钩 fetch / XHR / Image，拿到「谁发起的」调用栈
await page.addInitScript(() => {
  window.__trace = []
  const origFetch = window.fetch
  window.fetch = function (...args) {
    const url = String(args[0]?.url || args[0] || '')
    window.__trace.push({ kind: 'fetch', url, stack: new Error().stack })
    return origFetch.apply(this, args)
  }
  const OrigImage = window.Image
  window.Image = function (...args) {
    const img = new OrigImage(...args)
    window.__trace.push({ kind: 'Image', url: '(constructor)', stack: new Error().stack })
    return img
  }
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    set(v) {
      window.__trace.push({ kind: 'img.src', url: String(v), stack: new Error().stack })
      return desc.set.call(this, v)
    },
    get() { return desc.get.call(this) }
  })
})

const failedRequests = []
page.on('request', (req) => failedRequests.push(req.url()))

await page.goto(URL_TO_TEST, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

console.log('=== characters 请求的来源 ===')
const trace = await page.evaluate(() => window.__trace.filter((t) => t.url.includes('characters')))
if (!trace.length) console.log('  （没有任何 characters 请求）')
for (const t of trace) {
  console.log(`  [${t.kind}] ${t.url}`)
  console.log('    栈顶三帧:')
  for (const line of String(t.stack).split('\n').slice(1, 4)) console.log('      ' + line.trim())
}

console.log('\n=== 当前设置 ===')
const st = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('kivotos-kaoyan-v1'))?.settings ?? null } catch { return null }
})
console.log('  customCharacters =', st?.customCharacters)


console.log('=== 实际发出的请求 ===')
for (const u of failedRequests) console.log('  ' + u.replace(URL_TO_TEST, '(base) '))

console.log('\n=== 失败/4xx 的请求 ===')
if (!failed.length) console.log('  （无）')
for (const f of failed) console.log('  ' + f.replace(URL_TO_TEST, '(base) '))

console.log('\n=== 页面是否真的渲染出来了 ===')
const info = await page.evaluate(() => ({
  title: document.title,
  h1: document.querySelector('.section-title, .countdown__label')?.textContent?.trim() || '',
  days: document.querySelector('#cdDays')?.textContent?.trim() || '(无倒计时)',
  haloCount: document.querySelectorAll('.halo').length,
  svgCount: document.querySelectorAll('.ch__svg').length,
  imgCount: document.querySelectorAll('.mascot__img').length,
  navCount: document.querySelectorAll('.nav-item').length,
  appHTML: document.getElementById('app')?.innerHTML?.length || 0
}))
console.log(JSON.stringify(info, null, 2))

await browser.close()
