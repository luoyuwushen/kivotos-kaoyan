/**
 * 侦察脚本：用真实浏览器打开蔚蓝档案官网，抓取视觉 Token 与截图。
 * 仅用于设计参考（颜色 / 形状 / 排版 / 动效），不复制任何素材。
 *   node scripts/ba-recon.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve('ba-recon')
const TARGETS = [
  { name: 'jp', url: 'https://bluearchive.jp/' },
  { name: 'cn', url: 'https://bluearchive-cn.com/' },
  { name: 'global', url: 'https://bluearchive.nexon.com/' }
]

const PROBE = () => {
  const hex = (rgb) => {
    const m = /rgba?\(([^)]+)\)/.exec(rgb || '')
    if (!m) return null
    const p = m[1].split(',').map((v) => parseFloat(v))
    if (p.length > 3 && p[3] === 0) return null
    return (
      '#' +
      p
        .slice(0, 3)
        .map((v) => Math.round(v).toString(16).padStart(2, '0'))
        .join('')
    )
  }

  const counts = { fill: {}, color: {}, border: {}, radius: {}, font: {}, shadow: {} }
  const bump = (bucket, key) => {
    if (!key || key === 'none' || key === 'normal') return
    counts[bucket][key] = (counts[bucket][key] || 0) + 1
  }

  let nodes = 0
  for (const node of document.querySelectorAll('body *')) {
    const s = getComputedStyle(node)
    if (s.display === 'none' || s.visibility === 'hidden') continue
    const r = node.getBoundingClientRect()
    if (r.width < 6 || r.height < 6) continue
    nodes++
    bump('fill', hex(s.backgroundColor))
    bump('color', hex(s.color))
    if (s.borderTopWidth !== '0px') bump('border', `${s.borderTopWidth} ${hex(s.borderTopColor)}`)
    bump('radius', s.borderTopLeftRadius)
    bump('font', `${s.fontFamily.split(',')[0].replace(/["']/g, '')} ${s.fontWeight}`)
    if (s.boxShadow !== 'none') bump('shadow', s.boxShadow.slice(0, 90))
  }

  const top = (bucket, n = 12) =>
    Object.entries(counts[bucket])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, count }))

  // 背景层：找出所有用了渐变/图片的容器
  const backgrounds = []
  for (const node of document.querySelectorAll('body *')) {
    const s = getComputedStyle(node)
    const bg = s.backgroundImage
    if (!bg || bg === 'none') continue
    const r = node.getBoundingClientRect()
    if (r.width < 80 || r.height < 40) continue
    backgrounds.push({
      tag: node.tagName.toLowerCase(),
      cls: (node.className || '').toString().slice(0, 70),
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      bg: bg.slice(0, 220)
    })
  }

  // 字体文件
  const fonts = [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.style}`)

  return {
    nodes,
    title: document.title,
    counts: {
      fill: top('fill', 14),
      color: top('color', 10),
      border: top('border', 8),
      radius: top('radius', 12),
      font: top('font', 10),
      shadow: top('shadow', 6)
    },
    backgrounds: backgrounds.slice(0, 26),
    fonts: [...new Set(fonts)].slice(0, 24),
    scrollHeight: document.documentElement.scrollHeight
  }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const report = {}

  for (const target of TARGETS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      console.log(`\n=== ${target.name} ${target.url}`)
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(4500)

      // 关掉常见的 cookie / 年龄弹窗
      for (const label of ['同意', '同意する', 'Accept', 'OK', '同意全部', '进入']) {
        const btn = page.getByRole('button', { name: label, exact: false }).first()
        if (await btn.count().catch(() => 0)) {
          await btn.click({ timeout: 1500 }).catch(() => {})
        }
      }
      await page.waitForTimeout(1500)

      await page.screenshot({ path: path.join(OUT, `${target.name}-hero.png`) })

      const probe = await page.evaluate(PROBE)
      report[target.name] = probe
      console.log('  title:', probe.title)
      console.log('  nodes:', probe.nodes, 'height:', probe.scrollHeight)
      console.log('  fonts:', probe.fonts.slice(0, 8).join(' | '))
      for (const key of Object.keys(probe.counts)) {
        console.log(`  ${key}:`, probe.counts[key].slice(0, 6).map((x) => `${x.value}(${x.count})`).join(' '))
      }

      // 滚动到第二屏再抓一张（很多官网首屏之后才是重点）
      await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.2 }))
      await page.waitForTimeout(2500)
      await page.screenshot({ path: path.join(OUT, `${target.name}-2.png`) })

      await page.evaluate(() => window.scrollTo({ top: 0 }))
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(OUT, `${target.name}-full.png`), fullPage: true })
    } catch (err) {
      console.log(`  FAILED: ${err.message}`)
      report[target.name] = { error: err.message }
    } finally {
      await page.close()
    }
  }

  await browser.close()
  await writeFile(path.join(OUT, 'tokens.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`\nwrote ${path.join(OUT, 'tokens.json')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
