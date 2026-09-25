import { DAY_SCENES, NIGHT_SCENES, sceneForHour } from './scene-time.js'

/**
 * ShittimLogon 的 workpage 实时场景；登录流程由调用方编排。
 * 角色和背景已经在同一套骨架中，不额外叠加独立 arona/plana。
 * Spine 运行时 © Esoteric Software LLC；素材来源见 docs/shittim-port.md。
 */
export const BUNDLES = {
  'office-day': 'arona_workpage_daytime_2',
  'office-night': 'arona_workpage_nighttime_2',
  arona: 'arona_spr',
  plana: 'NP0035_spr'
}

// 对应 ShittimLogon 1.4.1 render_still --list-scenes / --scene 的三轨编排。
export const SCENES = {
  day_1: { room: 'office-day', hero: 'Idle_00', companion: 11, gain: 0.9 },
  day_2: { room: 'office-day', hero: 'Idle_00', companion: 12, gain: 0.9 },
  day_3: { room: 'office-day', hero: 'Idle_01', companion: 0, gain: 0.9 },
  day_4: { room: 'office-day', hero: 'Idle_02', companion: 0, gain: 0.9 },
  night_1: { room: 'office-night', hero: 'Idle_00', companion: 0, gain: 1 },
  night_2: { room: 'office-night', hero: 'Idle_01', companion: 0, gain: 1 },
  night_3: { room: 'office-night', hero: 'Idle_01', companion: 11, gain: 1 },
  night_4: { room: 'office-night', hero: 'Idle_02', companion: 0, gain: 1 },
  night_5: { room: 'office-night', hero: 'Idle_03', companion: 0, gain: 1 }
}
export { DAY_SCENES, NIGHT_SCENES }

// 原项目 adapter/scene.h 的 roomViewport：中心 (0,900)，2880×1620，uniform cover。
const ROOM_FRAME = { minX: -1440, minY: 90, maxX: 1440, maxY: 1710 }
const DRAW_ORDER = ['office-day', 'office-night', 'plana', 'arona']
let runtimePromise
function loadRuntime() {
  return runtimePromise ||= Promise.all([
    import('@esotericsoftware/spine-core'),
    import('@esotericsoftware/spine-webgl')
  ]).then(([core, webgl]) => ({ core, webgl }))
}
const abortError = () => new DOMException('场景已释放', 'AbortError')

export class SceneStage {
  #returnTo = null

  /** @param {{scene?: string}} opts 支持 room id 或 day_1/night_1 等具体场景名。 */
  constructor(canvas, opts = {}) {
    this.canvas = canvas
    this.sceneName = SCENES[opts.scene] ? opts.scene : opts.scene === 'office-night' ? 'night_1' : 'day_1'
    this.scene = SCENES[this.sceneName].room
    this.sceneSpec = null
    this.items = new Map()
    this.hidden = new Set()
    this.pending = new Map()
    this.abortController = new AbortController()
    this.disposed = false
    this.running = false
    this.lastTime = 0
    this.rafId = 0
    // 世界几何与图集分辨率无关：降采样不能改变骨架的位置和尺寸。
    this.skeletonScale = 1
    this.sizeOverride = null
    this.frame = null
    this.core = this.webgl = this.gl = this.renderer = this.camera = null
    this.loadPromise = null
  }

  /** 同一实例重复调用只初始化一次；dispose 可中止尚未完成的网络请求。 */
  load() {
    if (this.disposed) return Promise.reject(abortError())
    return this.loadPromise ||= this.#initialize().catch((error) => {
      this.dispose()
      throw error
    })
  }

  async #initialize() {
    const { core, webgl } = await loadRuntime()
    if (this.disposed) throw abortError()
    this.core = core
    this.webgl = webgl
    this.gl = this.canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true })
    if (!this.gl) throw new Error('浏览器没有可用的 WebGL')
    this.glContext = new webgl.ManagedWebGLRenderingContext(this.gl)
    this.renderer = new webgl.SceneRenderer(this.canvas, this.glContext, true)
    // SceneRenderer.begin() 使用的是 renderer.camera；必须持有同一个对象。
    this.camera = this.renderer.camera
    await this.ensureRoom(this.scene)
    if (this.disposed) throw abortError()
    this.resize()
    this.playScene(this.sceneName)
    this.drawOnce()
    return this
  }

  async #loadBundle(id) {
    const base = BUNDLES[id]
    if (!base) throw new Error(`未知素材包 ${id}`)
    const { signal } = this.abortController
    const url = (file) => new URL(`shittim/${file}`, document.baseURI).href
    const fetchAsset = async (file, kind) => {
      const response = await fetch(url(file), { signal })
      if (!response.ok) throw new Error(`素材加载失败：${file} (${response.status})`)
      return response[kind]()
    }
    const [atlasText, bytes] = await Promise.all([
      fetchAsset(`${base}.atlas`, 'text'), fetchAsset(`${base}.skel`, 'arrayBuffer')
    ])
    if (this.disposed) throw abortError()
    const atlas = new this.core.TextureAtlas(atlasText)
    const images = []
    try {
      // allSettled 保证任何一页失败时，其余页已创建的 GPU 纹理也能统一释放。
      const loaded = await Promise.allSettled(atlas.pages.map(async (page) => {
        const blob = await fetchAsset(page.name, 'blob')
        const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' })
        images.push(bitmap)
        if (this.disposed) throw abortError()
        if (bitmap.width > this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) ||
            bitmap.height > this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) {
          throw new Error('设备支持的纹理尺寸不足')
        }
        if (bitmap.width !== page.width || bitmap.height !== page.height) {
          throw new Error(`图集与 PNG 尺寸不一致：${page.name}`)
        }
        // 源 PNG 是 straight alpha，上传和 drawSkeleton 都保持同一约定。
        this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        page.setTexture(new this.webgl.GLTexture(this.glContext, bitmap))
      }))
      const failed = loaded.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
      if (this.disposed) throw abortError()
      const binary = new this.core.SkeletonBinary(new this.core.AtlasAttachmentLoader(atlas))
      binary.scale = this.skeletonScale
      const data = binary.readSkeletonData(new Uint8Array(bytes))
      const skeleton = new this.core.Skeleton(data)
      skeleton.setToSetupPose()
      skeleton.updateWorldTransform(this.core.Physics.reset)
      const stateData = new this.core.AnimationStateData(data)
      stateData.defaultMix = 0.15
      return { base, data, atlas, skeleton, images, state: new this.core.AnimationState(stateData) }
    } catch (error) {
      atlas.dispose()
      images.forEach((bitmap) => bitmap.close())
      throw error
    }
  }

  async ensureRoom(room) {
    if (this.disposed) throw abortError()
    if (this.items.has(room)) return this.items.get(room)
    if (!this.pending.has(room)) {
      const promise = this.#loadBundle(room).then((item) => {
        if (this.disposed) {
          this.#releaseItem(item)
          throw abortError()
        }
        this.items.set(room, item)
        return item
      }).finally(() => this.pending.delete(room))
      this.pending.set(room, promise)
    }
    return this.pending.get(room)
  }

  /** 按 CSS 尺寸同步像素缓冲；固定世界取景框在 resize 后仍保持等比 cover。 */
  resize() {
    if (!this.renderer || this.disposed) return false
    const rect = this.sizeOverride
      ? { width: this.sizeOverride[0], height: this.sizeOverride[1] }
      : this.canvas.getBoundingClientRect()
    const dpr = this.sizeOverride ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round((rect.width || 1) * dpr))
    const height = Math.max(1, Math.round((rect.height || 1) * dpr))
    const changed = this.canvas.width !== width || this.canvas.height !== height
    if (changed) {
      this.canvas.width = width
      this.canvas.height = height
    }
    this.gl.viewport(0, 0, width, height)
    this.camera.setViewport(width, height)
    if (changed && this.frame) this.#applyFrame()
    return changed
  }

  relayout() { this.resize(); this.drawOnce() }

  #applyFrame() {
    const { box, mode, margin } = this.frame
    const width = (box.maxX - box.minX) * (1 + margin * 2)
    const height = (box.maxY - box.minY) * (1 + margin * 2)
    // OrthoCamera 的 zoom 是世界单位/像素，越大越远，不是屏幕放大倍率。
    const fit = mode === 'cover' ? Math.min : Math.max
    this.camera.zoom = fit(width / this.camera.viewportWidth, height / this.camera.viewportHeight)
    this.camera.position.set((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0)
    this.camera.update()
  }

  fitTo(box, { mode = 'contain', margin = 0.06 } = {}) {
    if (!this.camera || this.disposed || !box) return
    this.frame = { box: { ...box }, mode, margin }
    this.#applyFrame()
  }

  fitScene() {
    const scale = this.skeletonScale
    this.fitTo(Object.fromEntries(Object.entries(ROOM_FRAME).map(([k, v]) => [k, v * scale])),
      { mode: 'cover', margin: 0 })
  }

  viewportRect() {
    if (!this.camera) return null
    const width = this.camera.viewportWidth * this.camera.zoom
    const height = this.camera.viewportHeight * this.camera.zoom
    return { left: this.camera.position.x - width / 2, right: this.camera.position.x + width / 2,
      bottom: this.camera.position.y - height / 2, top: this.camera.position.y + height / 2 }
  }

  playScene(name) {
    if (this.disposed) return null
    const spec = SCENES[name]
    if (!spec) return null
    const room = this.items.get(spec.room)
    if (!room) return { scene: name, started: [], missing: [`room:${spec.room}`], needsRoom: spec.room }
    this.sceneName = name
    this.scene = spec.room
    this.sceneSpec = spec
    this.#returnTo = null
    room.state.clearTracks()
    // 仅 clearTracks 不会移除上一幕已经挂上的附件；必须恢复 setup pose。
    room.skeleton.setToSetupPose()
    const tracks = [[0, 'Idle_background_00'], [1, spec.hero]]
    if (spec.companion) tracks.push([4, `Idle_${String(spec.companion).padStart(2, '0')}`])
    const started = [], missing = []
    for (const [track, animation] of tracks) {
      if (room.data.findAnimation(animation)) {
        room.state.setAnimation(track, animation, true)
        started.push(`track${track}:${animation}`)
      } else missing.push(animation)
    }
    room.state.apply(room.skeleton)
    room.skeleton.updateWorldTransform(this.core.Physics.reset)
    this.fitScene()
    return { scene: name, room: spec.room, started, missing }
  }

  async switchScene(name) {
    const next = SCENES[name] ? name : name === 'office-night' ? 'night_1' : 'day_1'
    await this.ensureRoom(SCENES[next].room)
    return this.playScene(next)
  }

  static sceneForHour(hour = new Date().getHours()) {
    return sceneForHour(hour)
  }

  poke(kind = 'A') {
    if (this.disposed || !this.sceneSpec) return null
    const room = this.items.get(this.scene)
    const hero = this.sceneSpec.hero
    const animation = `${hero}_Touch_${kind}`
    if (!room?.data.findAnimation(animation)) return null
    room.state.setAnimation(1, animation, false)
    this.#returnTo = hero
    return animation
  }

  update(delta) {
    if (this.disposed || !this.core) return
    for (const [id, item] of this.items) {
      if (id.startsWith('office-') && id !== this.scene) continue
      item.skeleton.update(delta)
      item.state.update(delta)
      item.state.apply(item.skeleton)
      item.skeleton.updateWorldTransform(this.core.Physics.update)
    }
    const room = this.items.get(this.scene)
    if (this.#returnTo && room?.state.tracks[1]?.isComplete()) {
      room.state.setAnimation(1, this.#returnTo, true)
      this.#returnTo = null
    }
  }

  drawOnce() {
    if (!this.renderer || !this.camera || this.disposed || this.gl.isContextLost()) return
    const gl = this.gl
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.camera.update()
    this.renderer.begin()
    for (const id of DRAW_ORDER) {
      const item = this.items.get(id)
      if (!item || this.hidden.has(id) || (id.startsWith('office-') && id !== this.scene)) continue
      if (this.debugDraw) this.renderer.drawSkeletonDebug(item.skeleton, false)
      else this.renderer.drawSkeleton(item.skeleton, this.drawPremultiplied === true)
    }
    this.renderer.end()
    // 原版 gain 在合成之后缩 RGB；黑色覆盖等价，并通过 colorMask 保留 alpha。
    const gain = this.sceneSpec?.gain ?? 1
    if (gain < 1) {
      const box = this.viewportRect()
      gl.colorMask(true, true, true, false)
      this.renderer.rect(true, box.left, box.bottom, box.right - box.left, box.top - box.bottom,
        new this.core.Color(0, 0, 0, 1 - gain))
      this.renderer.end()
      gl.colorMask(true, true, true, true)
    }
  }

  snapshot() {
    if (this.disposed || !this.renderer) return ''
    this.resize()
    this.drawOnce()
    return this.canvas.toDataURL('image/png')
  }

  start(onFrame) {
    if (this.disposed || this.running || !this.renderer) return
    this.running = true
    this.lastTime = 0
    const loop = (now) => {
      if (this.disposed || !this.running) return
      const time = now / 1000
      const delta = this.lastTime ? Math.min(time - this.lastTime, 1 / 20) : 1 / 60
      this.lastTime = time
      this.update(delta)
      onFrame?.(delta, time)
      if (this.disposed || !this.running) return
      this.drawOnce()
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.lastTime = 0
  }

  #releaseItem(item) {
    item.atlas.dispose()
    item.images?.forEach((bitmap) => bitmap.close())
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.abortController.abort()
    for (const item of this.items.values()) this.#releaseItem(item)
    this.items.clear()
    this.renderer?.dispose()
    this.glContext?.dispose()
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }

  // 以下是探针接口；生产取景始终使用上面的原版固定机位。
  play(id, animation, { loop = true, track = 0, mix = 0.25 } = {}) {
    const item = this.items.get(id)
    if (!item?.data.findAnimation(animation) || this.disposed) return false
    item.state.data.defaultMix = mix
    item.state.setAnimation(track, animation, loop)
    return true
  }
  current(id, track = 0) { return this.items.get(id)?.state.tracks[track]?.animation?.name || null }
  isComplete(id, track = 0) { return this.items.get(id)?.state.tracks[track]?.isComplete() ?? false }
  animations(id) { return this.items.get(id)?.data.animations.map((animation) => animation.name) || [] }
  place(id, { x = 0, y = 0, scale = 1, flipX = false } = {}) {
    const item = this.items.get(id)
    if (!item) return false
    Object.assign(item.skeleton, { x, y, scaleX: flipX ? -scale : scale, scaleY: scale })
    item.skeleton.updateWorldTransform(this.core.Physics.reset)
    return true
  }
  boneBounds(id) {
    const bones = this.items.get(id)?.skeleton.bones
    if (!bones?.length) return null
    return { minX: Math.min(...bones.map((b) => b.worldX)), maxX: Math.max(...bones.map((b) => b.worldX)),
      minY: Math.min(...bones.map((b) => b.worldY)), maxY: Math.max(...bones.map((b) => b.worldY)) }
  }
  contentBounds() {
    const offset = new this.core.Vector2(), size = new this.core.Vector2()
    const boxes = []
    for (const [id, item] of this.items) {
      if (this.hidden.has(id) || (id.startsWith('office-') && id !== this.scene)) continue
      // 官方 getBounds 会计算加权网格/region 的世界顶点，骨骼与附件共享同一世界空间。
      item.skeleton.getBounds(offset, size, [])
      if (Number.isFinite(offset.x + offset.y + size.x + size.y))
        boxes.push({ minX: offset.x, minY: offset.y, maxX: offset.x + size.x, maxY: offset.y + size.y })
    }
    return boxes.length ? { minX: Math.min(...boxes.map((b) => b.minX)), minY: Math.min(...boxes.map((b) => b.minY)),
      maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)) } : null
  }
  fitToContent({ margin = 0.06 } = {}) {
    const box = this.contentBounds()
    if (box) this.fitTo(box, { margin })
    return box
  }
  get zoomScale() { return 1 }
  calibrate() { return 1 }
  inspect() {
    return Object.fromEntries([...this.items].map(([id, item]) => [id, {
      base: item.base, bones: item.data.bones.map((b) => b.name), slots: item.data.slots.map((s) => s.name),
      skins: item.data.skins.map((s) => s.name),
      animations: item.data.animations.map((a) => ({ name: a.name, duration: +a.duration.toFixed(3) })),
      physics: item.data.physicsConstraints?.length || 0
    }]))
  }
}
