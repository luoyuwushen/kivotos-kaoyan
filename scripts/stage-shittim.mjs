/**
 * 从 ShittimLogon assets 搬运骨架、图集、贴图和九幕降级缩略图。
 * node scripts/stage-shittim.mjs "<assets 目录>" [--scale 0.5] [--out <目录>]
 * 默认原尺寸；图集坐标随 PNG 同比缩放，骨架世界几何保持不变。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { TextureAtlas } from '@esotericsoftware/spine-core'

/** 验证真实占用范围。rotate 90/270 时图集中的物理宽高需要交换。 */
export function validateAtlas(text, dimensions) {
  const atlas = new TextureAtlas(text)
  for (const page of atlas.pages) {
    const actual = dimensions[page.name]
    if (!actual || page.width !== actual.width || page.height !== actual.height)
      throw new Error(`图集与 PNG 尺寸不一致：${page.name}`)
  }
  for (const region of atlas.regions) {
    const quarterTurn = region.degrees % 180 !== 0
    const width = quarterTurn ? region.height : region.width
    const height = quarterTurn ? region.width : region.height
    if (region.x < 0 || region.y < 0 || region.x + width > region.page.width || region.y + height > region.page.height)
      throw new Error(`图集区域越界：${region.page.name} / ${region.name}`)
  }
  return atlas
}

/** 同时支持 bounds/offsets 和 xy/size/orig/offset；offsets 是裁剪偏移，不能 clamp。 */
export function scaleAtlas(text, original, target) {
  validateAtlas(text, original)
  let page = null, header = false
  const fields = new Set(['bounds', 'offsets', 'xy', 'size', 'orig', 'offset'])
  const result = text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (Object.hasOwn(original, trimmed)) {
      page = trimmed
      header = true
      return line
    }
    if (!trimmed || !page) return line
    const match = /^(\s*)(\w+):\s*(.*)$/.exec(line)
    if (!match) { header = false; return line }
    const [, indent, key, value] = match
    if (header) {
      if (key === 'size') return `${indent}size:${target[page].width},${target[page].height}`
      return line
    }
    if (!fields.has(key)) return line
    const ratio = target[page].width / original[page].width
    if (Math.abs(ratio - target[page].height / original[page].height) > 1e-8)
      throw new Error('图集贴图必须等比缩放')
    const values = value.split(',').map(Number)
    if (values.some((number) => !Number.isFinite(number))) throw new Error(`无效图集数值：${line}`)
    return `${indent}${key}:${values.map((number) => Math.round(number * ratio)).join(',')}`
  }).join('\n')
  validateAtlas(result, target)
  return result
}

function main() {
  const source = process.argv[2]
  if (!source) throw new Error('用法：node scripts/stage-shittim.mjs "<assets 目录>" [--scale 0.5] [--out <目录>]')
  const scaleIndex = process.argv.indexOf('--scale')
  const scale = scaleIndex < 0 ? 1 : Number(process.argv[scaleIndex + 1])
  if (!(scale > 0 && scale <= 1)) throw new Error('--scale 必须在 (0,1] 之间')
  const outIndex = process.argv.indexOf('--out')
  const output = outIndex < 0 ? 'public/shittim' : process.argv[outIndex + 1]
  if (resolve(source) === resolve(output)) throw new Error('输出目录不能覆盖源素材目录')
  mkdirSync(output, { recursive: true })
  const bases = ['arona_spr', 'NP0035_spr', 'arona_workpage_daytime_2', 'arona_workpage_nighttime_2']
  const pngSize = (path) => {
    const bytes = readFileSync(path)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  for (const base of bases) {
    const text = readFileSync(join(source, `${base}.atlas`), 'utf8')
    const atlas = new TextureAtlas(text)
    const original = Object.fromEntries(atlas.pages.map((page) => [page.name, pngSize(join(source, page.name))]))
    const target = Object.fromEntries(Object.entries(original).map(([name, size]) => [name, {
      width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale))
    }]))
    validateAtlas(text, original)
    const next = scale === 1 ? text : scaleAtlas(text, original, target)
    for (const page of atlas.pages) {
      const from = join(source, page.name), to = join(output, page.name)
      if (scale === 1) copyFileSync(from, to)
      else execFileSync('python', ['-c',
        'from PIL import Image; import sys; im=Image.open(sys.argv[1]); im.resize((int(sys.argv[3]),int(sys.argv[4])),Image.Resampling.LANCZOS).save(sys.argv[2],optimize=True)',
        from, to, String(target[page.name].width), String(target[page.name].height)])
      console.log(`${page.name}: ${target[page.name].width}×${target[page.name].height}, ${(statSync(to).size / 1048576).toFixed(2)} MB`)
    }
    writeFileSync(join(output, `${base}.atlas`), next)
    copyFileSync(join(source, `${base}.skel`), join(output, `${base}.skel`))
  }
  const stills = ['enter_splash.png', 'enter_splash_day.png',
    ...['day_1','day_2','day_3','day_4','night_1','night_2','night_3','night_4','night_5'].map((name) => `thumb-${name}.png`)]
  for (const file of stills) copyFileSync(join(source, file), join(output, file))
  writeFileSync(join(output, 'README.md'), `# ShittimLogon 登录场景素材\n\n角色与场景素材来自 ShittimLogon 1.4.1，非本站原创，相关版权属于 Nexon / Yostar 及原权利人。Spine 运行时 © Esoteric Software LLC，按 Spine Runtimes License 使用。详见 docs/shittim-port.md。\n\n本站为个人备考自用的非商业网站，无广告、无收费、无任何形式的盈利。如有版权问题，请联系 2651038380@qq.com。\n\n由 scripts/stage-shittim.mjs 生成。本次图集缩放比例：${scale}。原 PNG 的真实尺寸与源 atlas 声明一致；旋转区域按实际占用范围验证，偏移不裁切。骨架几何无需随贴图分辨率调整。\n\nworkpage 包含角色和背景；thumb-*.png 用于加载中与 WebGL 不可用时的同幕静态图；enter_splash*.png 用于进入动画。\n`)
  console.log(`输出目录：${resolve(output)}`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
