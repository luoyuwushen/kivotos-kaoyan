/**
 * 验收：三轨叠加是否与官方 render_still.exe 打印的结构一致。
 *
 * 官方 day_1 的标准答案：
 *     [0] scene day_1 -> room arona_workpage_daytime_2, Idle_00, companion 11, gain 0.90
 *     track 0  Idle_background_00       loop
 *     track 1  Idle_00                  loop
 *     track 4  Idle_11                  loop
 *
 * 这个脚本逐幕检查我们起的轨与它是否一一对应，并实拍一张。
 *
 *   node scripts/verify-scene-tracks.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4320/'
const OUT = join(tmpdir(), 'kaoyan-tracks')
await mkdir(OUT, { recursive: true })

/** 官方 render_still.exe 打印出来的标准答案（原样抄录） */
const OFFICIAL = {
  day_1: { room: 'office-day', tracks: { 0: 'Idle_background_00', 1: 'Idle_00', 4: 'Idle_11' } },
  day_2: { room: 'office-day', tracks: { 0: 'Idle_background_00', 1: 'Idle_00', 4: 'Idle_12' } },
  day_3: { room: 'office-day', tracks: { 0: 'Idle_background_00', 1: 'Idle_01' } },
  day_4: { room: 'office-day', tracks: { 0: 'Idle_background_00', 1: 'Idle_02' } },
  night_1: { room: 'office-night', tracks: { 0: 'Idle_background_00', 1: 'Idle_00' } },
  night_2: { room: 'office-night', tracks: { 0: 'Idle_background_00', 1: 'Idle_01' } },
  night_3: { room: 'office-night', tracks: { 0: 'Idle_background_00', 1: 'Idle_01', 4: 'Idle_11' } },
  night_4: { room: 'office-night', tracks: { 0: 'Idle_background_00', 1: 'Idle_02' } },
  night_5: { room: 'office-night', tracks: { 0: 'Idle_background_00', 1: 'Idle_03' } }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 480, height: 270 }, locale: 'zh-CN' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await page.route('**://*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

await page.goto(`${BASE}?cb=${Date.now()}#scene`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__scene?.ready === true, { timeout: 60000 })

const api = await page.evaluate(() => ({
  hasPlayScene: typeof window.__scene.playScene === 'function',
  hasPoke: typeof window.__scene.poke === 'function',
  scenes: window.__scene.sceneNames ? window.__scene.sceneNames() : null
}))
check('探针暴露了 playScene', api.hasPlayScene)
check('探针暴露了 poke', api.hasPoke)

/* ---------- 逐幕校验轨道结构 ---------- */
for (const [scene, want] of Object.entries(OFFICIAL)) {
  // 先确保这一幕需要的房间已加载（日/夜是两套骨架，load() 只加载当前那一间）
  const info = await page.evaluate(async (s) => {
    const st = window.__scene.stage()
    const spec = window.__scene.sceneSpec(s)
    await st.ensureRoom(spec.room)
    return window.__scene.playScene(s)
  }, scene)

  if (!info) {
    check(`${scene} 起播`, false, 'playScene 返回 null')
    continue
  }

  // 实读每条轨当前挂的动画名
  const actual = await page.evaluate((roomHint) => {
    const st = window.__scene.stage()
    const room = st.items.get(roomHint)
    if (!room) return null
    const out = {}
    room.state.tracks.forEach((tr, i) => {
      if (tr?.animation) out[i] = tr.animation.name
    })
    return out
  }, want.room)

  const same =
    actual &&
    Object.keys(want.tracks).every((k) => actual[k] === want.tracks[k]) &&
    Object.keys(actual).length === Object.keys(want.tracks).length

  const fmt = (o) => (o ? Object.entries(o).map(([k, v]) => `t${k}:${v}`).join(' ') : '(空)')
  check(
    `${scene} 三轨结构`,
    Boolean(same),
    same ? fmt(actual) : `期望 ${fmt(want.tracks)} / 实际 ${fmt(actual)}`
  )
}

/* ---------- 点击交互（Touch 动画都在房间骨架上） ---------- */
await page.evaluate(async () => {
  const st = window.__scene.stage()
  await st.ensureRoom('office-day')
  window.__scene.playScene('day_1')
})
const poke = await page.evaluate(() => window.__scene.poke('A'))
check('点击触发 Touch 动画', Boolean(poke), poke || '（没找到）')

const returned = await page.evaluate(async () => {
  const st = window.__scene.stage()
  for (let i = 0; i < 120; i++) st.update(1 / 60)
  const room = st.items.get(st.sceneSpec.room)
  return room?.state.tracks[1]?.animation?.name || null
})
check('Touch 播完自动回待机', Boolean(returned) && !returned.includes('Touch'), returned || '(无)')

const pokeM = await page.evaluate(async () => {
  const st = window.__scene.stage()
  window.__scene.playScene('day_1')
  return window.__scene.poke('M')
})
check('M 型 Touch 也能播', Boolean(pokeM), pokeM || '（没找到）')

/* ---------- 实拍一张 ---------- */
const shot = await page.evaluate(async () => {
  const st = window.__scene.stage()
  window.__scene.playScene('day_1')
  for (let i = 0; i < 90; i++) st.update(1 / 60)
  st.resize()
  return { url: st.snapshot(), zoom: st.camera.zoom, pos: [st.camera.position.x, st.camera.position.y] }
})
await writeFile(join(OUT, 'day_1.png'), Buffer.from(shot.url.split(',')[1], 'base64'))
console.log(`\n实拍 day_1：zoom ${shot.zoom.toFixed(5)} 相机 ${shot.pos.map((v) => Math.round(v)).join(',')}`)

check('页面无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log('  · ' + f.name + (f.detail ? `  (${f.detail})` : ''))
  process.exitCode = 1
}
console.log('输出目录:', OUT)
