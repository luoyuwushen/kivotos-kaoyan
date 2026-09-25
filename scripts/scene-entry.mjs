/**
 * `probe-shittim-scene.mjs` 的入口：在 Node 里读一遍这几套 .skel，
 * 把骨架结构（骨骼数 / 插槽数 / 动画清单 / 每段动画时长）写进报告文件。
 *
 * 为什么需要单独一个入口 + esbuild 打包：
 *   `@esotericsoftware/spine-core` 的 dist 是「无扩展名 import」的 ESM，
 *   Node 的解析器不认（Vite 认）。先用 esbuild 打成单文件 CJS，Node 才跑得动。
 *
 * 这是**不开浏览器**的最快验证途径 —— 排查"骨架能不能解析"这类问题，
 * 比每次开 Playwright 快一个数量级。
 *
 * 被 `probe-shittim-scene.mjs` 通过 esbuild 打包调用，不直接运行。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  AtlasAttachmentLoader,
  Skeleton,
  SkeletonBinary,
  TextureAtlas,
  AnimationState,
  AnimationStateData,
  Physics
} from '@esotericsoftware/spine-core'

const DIR = 'public/shittim'
const lines = []
const say = (s = '') => lines.push(s)

/** 从 .skel 里读出骨架数据；atlas 只用来喂附件装载器（Node 侧不需要真贴图） */
function readSkeleton(base) {
  const atlasText = readFileSync(join(DIR, `${base}.atlas`), 'utf8')
  const atlas = new TextureAtlas(atlasText)
  const loader = new AtlasAttachmentLoader(atlas)
  const bin = new SkeletonBinary(loader)
  const data = bin.readSkeletonData(new Uint8Array(readFileSync(join(DIR, `${base}.skel`))))
  return { data, atlas }
}

const skels = readdirSync(DIR)
  .filter((f) => f.endsWith('.skel'))
  .sort()

say('='.repeat(70))
say(`骨架解析报告 —— 共 ${skels.length} 套`)
say('='.repeat(70))

for (const f of skels) {
  const base = f.replace(/\.skel$/, '')
  say()
  say(`${base}.skel`)
  try {
    const { data, atlas } = readSkeleton(base)
    const anims = data.animations.map((a) => a.name)

    say(`  版本 ${data.version}`)
    say(
      `  骨骼 ${data.bones.length}  插槽 ${data.slots.length}  皮肤 ${data.skins.length}  动画 ${anims.length}`
    )
    say(`  图集页 ${atlas.pages.map((p) => `${p.name}(${p.width}×${p.height})`).join(', ')}`)

    const idle = anims.filter((n) => /^Idle_\d\d$/.test(n))
    const bg = anims.filter((n) => n.includes('background'))
    const touch = anims.filter((n) => n.includes('Touch'))
    const rest = anims.filter((n) => !idle.includes(n) && !bg.includes(n) && !touch.includes(n))

    const dur = (name) => {
      const a = data.findAnimation(name)
      return a ? `${a.duration.toFixed(2)}s` : '-'
    }

    if (bg.length) say(`  背景动画：${bg.map((n) => `${n}(${dur(n)})`).join(', ')}`)
    if (idle.length) say(`  待机：${idle.map((n) => `${n}(${dur(n)})`).join(', ')}`)
    if (touch.length) {
      say(
        `  点击触发 ${touch.length} 段：${touch.slice(0, 6).join(', ')}${touch.length > 6 ? ' …' : ''}`
      )
      say(`  Touch 时长：${[...new Set(touch.map(dur))].join(' / ')}`)
    }
    if (rest.length) {
      say(`  其它 ${rest.length} 段：${rest.slice(0, 8).join(', ')}${rest.length > 8 ? ' …' : ''}`)
    }

    const physics = data.physicsConstraints?.length || 0
    say(
      `  物理约束 ${physics}${physics ? '（updateWorldTransform 必须传 Physics，否则抛错）' : ''}`
    )

    // setup pose 下带附件的插槽数 —— 这个数字能证明"角色是靠动画挂上去的"
    const sk = new Skeleton(data)
    sk.setToSetupPose()
    sk.updateWorldTransform(Physics.reset)
    say(
      `  setup pose 带附件的插槽 ${sk.slots.filter((s) => s.getAttachment()).length} / ${data.slots.length}`
    )

    // 各段动画点亮的插槽数 —— 确认每段 Idle 对应哪一组角色
    const state = new AnimationState(new AnimationStateData(data))
    for (const name of [...bg, ...idle]) {
      sk.setToSetupPose()
      state.clearTracks()
      state.setAnimation(0, name, true)
      for (let i = 0; i < 30; i++) {
        state.update(1 / 30)
        state.apply(sk)
        sk.updateWorldTransform(Physics.reset)
      }
      say(`    ${name.padEnd(22)} 点亮插槽 ${sk.slots.filter((s) => s.getAttachment()).length}`)
    }
  } catch (err) {
    say(`  解析失败：${err.message}`)
  }
}

say()
say('='.repeat(70))
writeFileSync('shittim-scene-report.txt', lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
