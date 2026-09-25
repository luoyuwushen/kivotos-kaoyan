/** 实际像素验收：九幕图像、可见角色、机位、触摸、暂停、异步释放；不连接线上认证。 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4330/'
const OUT = resolve(process.env.SHITTIM_OUTPUT || 'output/shittim')
await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } })
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(BASE).origin) return route.abort()
    if (url.pathname === '/__shittim_render_test') return route.fulfill({
      contentType: 'text/html', body: '<style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>'
    })
    if (url.pathname.startsWith('/shittim/')) requests.push(url.pathname)
    return route.continue()
  })
  await page.goto(new URL('__shittim_render_test', BASE).href)
  await page.evaluate(async () => {
    const mod = await import('/src/lib/scene-stage.js')
    window.SceneStage = mod.SceneStage; window.specs = mod.SCENES
    const stage = window.stage = new mod.SceneStage(document.querySelector('canvas'))
    await Promise.all([stage.load(), stage.load()])
  })
  assert.equal(await page.evaluate(() => stage.camera === stage.renderer.camera), true, '渲染器必须使用同一相机')
  assert.deepEqual(await page.evaluate(() => [...stage.items.keys()]), ['office-day'], '不加载独立角色')
  assert.deepEqual(await page.evaluate(() => stage.viewportRect()), { left: -1440, right: 1440, bottom: 90, top: 1710 })
  const results = []
  for (const name of await page.evaluate(() => Object.keys(specs))) {
    const result = await page.evaluate(async (name) => {
      const spec = specs[name]
      await Promise.all([stage.ensureRoom(spec.room), stage.ensureRoom(spec.room)])
      const result = stage.playScene(name)
      for (let frame = 0; frame < 120; frame++) stage.update(1 / 60)
      const room = stage.items.get(spec.room)
      const tracks = room.state.tracks.flatMap((entry, track) => entry ? [[track, entry.animation.name]] : [])
      const visible = room.skeleton.slots.filter((slot) => slot.getAttachment() && slot.color.a > 0)
      return { name, ...result, tracks, visible: visible.length, image: stage.snapshot() }
    }, name)
    assert.deepEqual(result.missing, [], `${name} 动画齐全`)
    assert.ok(result.visible > 20, `${name} 角色和背景均挂载`)
    await writeFile(join(OUT, `${name}.png`), Buffer.from(result.image.split(',')[1], 'base64'))
    delete result.image
    results.push(result)
    console.log(`${name}: ${result.visible} 个可见插槽，${result.tracks.length} 条轨道，已保存实际渲染 PNG`)
  }
  assert.equal(requests.filter((url) => url.endsWith('daytime_2.atlas')).length, 1)
  assert.equal(requests.filter((url) => url.endsWith('nighttime_2.atlas')).length, 1)
  const behavior = await page.evaluate(async () => {
    stage.playScene('day_1'); stage.update(2)
    const original = stage.snapshot()
    stage.camera.zoom *= 1.3
    const moved = stage.snapshot()
    stage.fitScene()
    const poke = stage.poke('A')
    const repeated = stage.poke('A')
    for (let frame = 0; frame < 100; frame++) stage.update(1 / 60)
    const returned = stage.current('office-day', 1)
    stage.poke('A'); stage.playScene('day_3'); stage.update(2)
    const switched = stage.current('office-day', 1)
    stage.start(); await new Promise((resolve) => setTimeout(resolve, 80)); stage.stop()
    const trackTime = stage.items.get('office-day').state.tracks[1].trackTime
    await new Promise((resolve) => setTimeout(resolve, 80))
    return { cameraChangesPixels: original !== moved, poke, repeated, returned, switched,
      paused: trackTime === stage.items.get('office-day').state.tracks[1].trackTime, raf: stage.rafId }
  })
  assert.equal(behavior.cameraChangesPixels, true)
  assert.equal(behavior.poke, 'Idle_00_Touch_A')
  assert.equal(behavior.repeated, 'Idle_00_Touch_A')
  assert.equal(behavior.returned, 'Idle_00')
  assert.equal(behavior.switched, 'Idle_01')
  assert.equal(behavior.paused, true)
  assert.equal(behavior.raf, 0)
  await page.setViewportSize({ width: 960, height: 540 })
  assert.deepEqual(await page.evaluate(() => { stage.relayout(); return stage.viewportRect() }),
    { left: -1440, right: 1440, bottom: 90, top: 1710 }, '等比例 resize 保持世界框')
  const disposed = await page.evaluate(async () => {
    stage.dispose(); stage.dispose()
    const fresh = new SceneStage(document.createElement('canvas'))
    const loading = fresh.load().catch((error) => error.name)
    fresh.dispose()
    return { early: await loading, items: stage.items.size, running: stage.running,
      snapshot: stage.snapshot(), glLost: stage.gl.isContextLost(), freshGl: fresh.gl }
  })
  assert.equal(disposed.early, 'AbortError')
  assert.equal(disposed.items, 0)
  assert.equal(disposed.running, false)
  assert.equal(disposed.snapshot, '')
  assert.equal(disposed.glLost, true)
  assert.equal(disposed.freshGl, null)
  assert.deepEqual(errors, [])
  await writeFile(join(OUT, 'render-report.json'), JSON.stringify({ scenes: results, behavior, disposed, requests, errors }, null, 2))
  console.log('通过：九幕加载、重复请求合并、相机像素差、触摸恢复、场景切换、resize、暂停、释放及提前取消。')
} finally { await browser.close() }
