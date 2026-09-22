/**
 * 把 ShittimLogon 的 Spine 素材搬进 public/shittim/，并按需降采样贴图。
 *
 *   node scripts/stage-shittim.mjs <ShittimLogon 的 assets 目录> [--scale 0.5]
 *
 * 为什么要降采样：workpage 场景的贴图是 4096×4096，单张 PNG 10MB、显存 64MB，
 * 一张页面两张就是 128MB —— 手机直接崩。降采样后要同步改写 .atlas 里的
 * `size:` 字段（bounds 不动，因为那是贴图空间坐标，缩放后比例不变）。
 *
 * 贴图可能不止一页（daytime 是 2 页），所以按 atlas 里出现的每个 .png 逐个处理。
 * 这一步只读源目录，不改动源目录。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

const src = process.argv[2]
if (!src) {
  console.error('用法: node scripts/stage-shittim.mjs "<assets 目录>" [--scale 0.5]')
  process.exit(2)
}
const scaleArg = process.argv.indexOf('--scale')
const SCALE = scaleArg > -1 ? Number(process.argv[scaleArg + 1]) : 0.5
if (!(SCALE > 0 && SCALE <= 1)) {
  console.error('--scale 要在 (0, 1] 之间')
  process.exit(2)
}

const OUT = 'public/shittim'
mkdirSync(OUT, { recursive: true })

/**
 * 要搬的东西分三类：
 *   · 角色骨骼：阿洛娜、普拉娜（各一套 skel + atlas + 贴图）
 *   · 场景骨骼：日间 / 夜间 office（各一套，贴图两页）
 *   · 进入画面：enter_splash（登录成功那一刻闪过的那个）
 * 语音包（200+ 条 mp3、共约 8MB）先不搬 —— 那是第二阶段的事，
 * 而且默认不播声音对"打开网站就被吵"更友好。
 */
const BUNDLES = [
  { id: 'arona', files: ['arona_spr.skel', 'arona_spr.atlas', 'arona_spr.png'] },
  { id: 'plana', files: ['NP0035_spr.skel', 'NP0035_spr.atlas', 'NP0035_spr.png'] },
  {
    id: 'office-day',
    files: [
      'arona_workpage_daytime_2.skel',
      'arona_workpage_daytime_2.atlas',
      'arona_workpage_daytime_2.png',
      'arona_workpage_daytime_2_2.png'
    ]
  },
  {
    id: 'office-night',
    files: [
      'arona_workpage_nighttime_2.skel',
      'arona_workpage_nighttime_2.atlas',
      'arona_workpage_nighttime_2.png',
      'arona_workpage_nighttime_2_2.png'
    ]
  },
  { id: 'enter-splash', files: ['enter_splash.png', 'enter_splash_day.png'] }
]

/** 用 Pillow 缩图 —— Node 侧没有图像库，这一台机器上有 Python + Pillow */
const PY_RESIZE = `
import sys
from PIL import Image
src, dst, scale = sys.argv[1], sys.argv[2], float(sys.argv[3])
im = Image.open(src)
w, h = im.size
nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
im = im.resize((nw, nh), Image.LANCZOS)
im.save(dst, optimize=True)
print(f"{w}x{h} -> {nw}x{nh}")
`

function resize(srcPath, dstPath, scale) {
  const out = execFileSync('python', ['-c', PY_RESIZE, srcPath, dstPath, String(scale)], {
    encoding: 'utf8'
  })
  return out.trim()
}

/**
 * 改写 .atlas 里的 `size:` 字段，并核对贴图真的存在。
 * atlas 的格式是：第一行是 png 文件名，紧跟若干 `key: value`，
 * 然后才是 region 块。所以只要按行扫，遇到 png 行就记下"下一页开始了"。
 */
function rewriteAtlas(atlasText, scaleMap) {
  const lines = atlasText.split(/\r?\n/)
  let currentPage = null
  const out = lines.map((line) => {
    const m = /^(\S+\.png)$/.exec(line.trim())
    if (m) {
      currentPage = m[1]
      return line
    }
    if (currentPage && /^size:\s*\d+\s*,\s*\d+\s*$/.test(line.trim())) {
      const info = scaleMap[currentPage]
      if (info) return `size:${info.w},${info.h}`
    }
    return line
  })
  return out.join('\n')
}

const report = []
for (const bundle of BUNDLES) {
  const lines = []
  const scaleMap = {}
  for (const f of bundle.files) {
    const from = join(src, f)
    if (!existsSync(from)) {
      lines.push(`  !! 缺文件 ${f}`)
      continue
    }
    const to = join(OUT, f)
    if (f.endsWith('.png') && SCALE < 1) {
      const dims = resize(from, to, SCALE)
      const [nw, nh] = dims.split('->')[1].trim().split('x').map(Number)
      scaleMap[f] = { w: nw, h: nh }
      lines.push(`  ${f.padEnd(38)} ${dims}  ${(statSync(to).size / 1048576).toFixed(1)}MB`)
    } else {
      copyFileSync(from, to)
      lines.push(`  ${f.padEnd(38)} 原样  ${(statSync(to).size / 1048576).toFixed(2)}MB`)
      if (f.endsWith('.png')) {
        // 不缩放时也要把尺寸记下来（可能只缩放部分）
        const buf = readFileSync(from)
        scaleMap[f] = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
      }
    }
  }
  // 改写 atlas 尺寸
  for (const f of bundle.files.filter((x) => x.endsWith('.atlas'))) {
    const atlasPath = join(OUT, f)
    if (!existsSync(atlasPath)) continue
    const before = readFileSync(atlasPath, 'utf8')
    const after = rewriteAtlas(before, scaleMap)
    if (after !== before) {
      writeFileSync(atlasPath, after, 'utf8')
      const sizes = Object.entries(scaleMap)
        .map(([k, v]) => `${basename(k)} ${v.w}x${v.h}`)
        .join(', ')
      lines.push(`  ${f.padEnd(38)} size: 已改写 -> ${sizes}`)
    }
  }
  report.push({ bundle: bundle.id, lines })
}

writeFileSync(
  join(OUT, 'README.md'),
  [
    '# public/shittim —— 登录场景素材（移植自 ShittimLogon）',
    '',
    '> 这些**不是本项目的原创素材**。角色与场景的 Spine 导出数据（骨骼、贴图、图集）',
    '> 权利属于其原权利人（《蔚蓝档案》相关权利人）；Spine 运行时 © Esoteric Originals LLC。',
    '> 详细来源与许可见仓库根目录 `docs/shittim-port.md`。',
    '',
    '由 `scripts/stage-shittim.mjs` 从 ShittimLogon 发行版搬运生成，不要手改。',
    '',
    '| 文件 | 用途 |',
    '|------|------|',
    '| `*_spr.skel/.atlas/.png` | 阿洛娜（arona）与普拉娜（NP0035）角色骨骼 |',
    '| `arona_workpage_*.skel/.atlas/.png` | 办公室场景（日间 / 夜间），各两页贴图 |',
    '| `enter_splash*.png` | 登录成功那一刻的进入画面 |',
    '',
    `本次搬运缩放比例：${SCALE}`,
    ''
  ].join('\n'),
  'utf8'
)

console.log(`\n输出目录: ${OUT}  （缩放 ${SCALE}）`)
for (const r of report) {
  console.log(`\n[${r.bundle}]`)
  for (const l of r.lines) console.log(l)
}
const total = execFileSync('node', ['-e', `
const fs=require('fs');
let n=0;
for (const f of fs.readdirSync('${OUT}')) n+=fs.statSync('${OUT}/'+f).size;
console.log((n/1048576).toFixed(1));
`], { encoding: 'utf8' }).trim()
console.log(`\n合计: ${total} MB`)
