/**
 * 蔚蓝档案登录场景（移植自 ShittimLogon）
 * ------------------------------------------------------------------
 * 用官方 Spine 4.2 运行时在浏览器里实时渲染 workpage 办公室场景，
 * 而不是播放一段烘焙好的视频 —— 这是 ShittimLogon 的做法，也是它出彩的地方：
 * 天色、光晕、角色都是活的，能跟着登录流程走。
 *
 * 这一层只负责「把骨架画出来 + 播动画 + 摆机位」，
 * 「什么时候播哪一段」由 views/login.js 决定。
 *
 * **运行时是动态 import 的，这一点很重要**：spine 那两个包加起来约 170KB（gzip ~50KB），
 * 静态 import 会被打进主 chunk，于是每个打开首页的人都要先下它 —— 而绝大多数访问
 * 根本不会走到登录屏。所以这里只在真正要画场景时才 import，
 * Vite 会把它拆成独立 chunk，没用到的人一个字节都不下。
 *
 * 授权：Spine 运行时 © Esoteric Software LLC（Spine Runtimes License）；
 * 角色与场景素材权利属于其原权利人。见 docs/shittim-port.md。
 */

/**
 * 素材包清单。路径全在 public/shittim/ 下 —— 不进 JS 包，
 * 这样登录屏本身还是那 160KB，场景是「要用的时候才开始下载」。
 */
export const BUNDLES = {
  'office-day': 'arona_workpage_daytime_2',
  'office-night': 'arona_workpage_nighttime_2',
  arona: 'arona_spr',
  plana: 'NP0035_spr'
}

/**
 * 绘制顺序：Spine 自己不做深度排序，谁先画谁在后面。
 * 办公室必须是底，角色压在它上面。
 */
const DRAW_ORDER = ['office-day', 'office-night', 'plana', 'arona']

/** 机位留白：包围盒外再留 6%，避免贴边 */
const PAD = 0.06

/**
 * 图集附件装载器。
 *
 * spine 的 SkeletonBinary 在读 region / mesh 附件时，会回调装载器要一个 TextureRegion；
 * 传 null 会抛 `Cannot read properties of null (reading 'newMeshAttachment')`，
 * 而只给一个空对象又会抛 `Region not set.`（attachments 在 updateRegion 里强校验）。
 *
 * 官方 spine-ts 4.2 的 `TextureAtlasAttachmentLoader` 只存在于 TypeScript 源码里，
 * npm 包的 dist 没导出它，所以这里按官方实现补一份：
 * 两个职责 —— 按附件名去图集里找 region，找不到就报清楚。
 */
class TextureAtlasAttachmentLoader {
  constructor(core, atlas) {
    this.core = core
    this.atlas = atlas
  }

  #region(name) {
    const region = this.atlas.findRegion(name)
    if (!region) throw new Error(`${name} region not found in atlas.`)
    return region
  }

  newRegionAttachment(skin, name, path, sequence) {
    const attachment = new this.core.RegionAttachment(name, path)
    attachment.region = this.#region(path || name)
    attachment.updateRegion()
    void skin
    void sequence
    return attachment
  }

  newMeshAttachment(skin, name, path, sequence) {
    const attachment = new this.core.MeshAttachment(name, path)
    attachment.region = this.#region(path || name)
    attachment.updateRegion()
    void skin
    void sequence
    return attachment
  }

  newBoundingBoxAttachment(skin, name) {
    void skin
    return new this.core.BoundingBoxAttachment(name)
  }

  newClippingAttachment(skin, name) {
    void skin
    return new this.core.ClippingAttachment(name)
  }

  newPathAttachment(skin, name) {
    void skin
    return new this.core.PathAttachment(name)
  }

  newPointAttachment(skin, name) {
    void skin
    return new this.core.PointAttachment(name)
  }
}

/** 运行时只加载一次，多个 SceneStage 共用同一份模块 */
let runtimePromise = null
function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import('@esotericsoftware/spine-core'),
      import('@esotericsoftware/spine-webgl')
    ]).then(([core, webgl]) => ({ core, webgl }))
  }
  return runtimePromise
}

/**
 * 把图片变成 spine 认得的贴图。
 *
 * 这里**必须**用官方的 GLTexture，不能自己拼一个 `{ glTexture, getImage, dispose }`：
 * SkeletonRenderer 在画的时候会调 `setWraps()` / `setFilters()`，
 * 自制的那个对象没有这些方法，运行时会报 `e.setWraps is not a function` 然后整屏空白。
 * （这就是第一版的写法，踩过。）
 */
async function loadTexture(webgl, context, src) {
  const img = await new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`贴图加载失败：${src}`))
    image.src = src
  })
  // useMipMaps=true：场景贴图是高分图缩小显示，没有 mipmap 会明显闪烁
  return new webgl.GLTexture(context, img, true)
}

export class SceneStage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ scene?: 'office-day'|'office-night' }} [opts]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas
    this.scene = opts.scene === 'office-night' ? 'office-night' : 'office-day'

    this.gl = null
    this.renderer = null
    this.camera = null
    /** @type {Map<string, {base:string, data:any, atlas:any, skeleton:any, state:any}>} */
    this.items = new Map()
    this.disposed = false
    this.lastTime = 0
    this.rafId = 0
    this.bounds = null
    /** @type {any} spine-core 模块（动态加载后填上） */
    this.core = null
  }

  /** 加载并初始化。失败时抛错，调用方负责降级。 */
  async load() {
    const { core, webgl } = await loadRuntime()
    this.core = core
    this.webgl = webgl

    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true
    })
    if (!gl) throw new Error('这个浏览器没有可用的 WebGL，场景跑不起来')
    this.gl = gl

    const context = new webgl.ManagedWebGLRenderingContext(gl)
    this.glContext = context
    this.renderer = new webgl.SceneRenderer(this.canvas, context, false)
    this.camera = new webgl.OrthoCamera(this.canvas.width || 1, this.canvas.height || 1)

    /**
     * 场景 + 阿洛娜。
     * 故意**不**把普拉娜也塞进来：她是"偶尔来串门"的第二个角色，
     * 一次性拉三个包（+1.2MB）在登录屏上是浪费；需要她的场景另外按需加载。
     */
    const wanted = [this.scene, 'arona']
    const loaded = await Promise.all(wanted.map((id) => this.#loadBundle(id)))
    wanted.forEach((id, i) => this.items.set(id, loaded[i]))

    this.#computeBounds()
    this.resize()
    return this
  }

  /** 读一个素材包：.skel（二进制骨骼）+ .atlas（图集）+ 贴图 */
  async #loadBundle(id) {
    const base = BUNDLES[id]
    if (!base) throw new Error(`未知素材包 ${id}`)
    const { Skeleton, SkeletonBinary, TextureAtlas, AnimationState, AnimationStateData } = this.core
    const url = (name) => new URL(`shittim/${name}`, document.baseURI).href

    const [skelRes, atlasRes] = await Promise.all([fetch(url(`${base}.skel`)), fetch(url(`${base}.atlas`))])
    if (!skelRes.ok) throw new Error(`读不到 ${base}.skel（HTTP ${skelRes.status}）`)
    if (!atlasRes.ok) throw new Error(`读不到 ${base}.atlas（HTTP ${atlasRes.status}）`)

    const [skelBuf, atlasText] = await Promise.all([skelRes.arrayBuffer(), atlasRes.text()])

    // .atlas 里的贴图名是相对路径，按 atlas 所在目录解析
    const atlas = new TextureAtlas(atlasText)
    await Promise.all(
      atlas.pages.map(async (page) => {
        page.setTexture(await loadTexture(this.webgl, this.glContext, url(page.name)))
      })
    )

    const loader = new TextureAtlasAttachmentLoader(this.core, atlas)
    const data = new SkeletonBinary(loader).readSkeletonData(new Uint8Array(skelBuf))
    const skeleton = new Skeleton(data)
    skeleton.setToSetupPose()
    skeleton.updateWorldTransform()

    return {
      base,
      data,
      atlas,
      skeleton,
      state: new AnimationState(new AnimationStateData(data))
    }
  }

  /**
   * 所有骨架合起来的世界包围盒 —— 机位靠它决定。
   * 不做这一步的话，场景要么小得像邮票、要么角色跑出画外。
   *
   * 只看骨骼端点是不够的（贴图可以伸到骨头之外很远），所以这里按骨骼长度
   * 往外扩一圈再取并集。宁可多留一点边，也别把画面裁掉。
   */
  #computeBounds() {
    const { Vector2 } = this.core
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const v = new Vector2()

    for (const item of this.items.values()) {
      const sk = item.skeleton
      sk.setToSetupPose()
      sk.updateWorldTransform()
      for (const bone of sk.bones) {
        v.set(bone.worldX, bone.worldY)
        const len = Math.abs(bone.length || 0)
        minX = Math.min(minX, v.x - len * 0.5)
        maxX = Math.max(maxX, v.x + len * 0.5)
        minY = Math.min(minY, v.y - len * 0.5)
        maxY = Math.max(maxY, v.y + len * 0.5)
      }
    }
    if (Number.isFinite(minX)) this.bounds = { minX, minY, maxX, maxY }
  }

  /** 画布尺寸变化：同步 drawingBuffer 与相机视口 */
  resize() {
    if (!this.renderer || this.disposed) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round((rect.width || 1) * dpr))
    const h = Math.max(1, Math.round((rect.height || 1) * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.camera.setViewport(this.canvas.width, this.canvas.height)
    this.#fitCamera()
  }

  /**
   * 机位收到包围盒上，cover 语义：短边对齐，长边居中裁切。
   * 竖屏手机上会裁掉两侧 —— 这是有意的，人物在中间，裁掉的是背景两边。
   */
  #fitCamera() {
    if (!this.bounds) return
    const { minX, minY, maxX, maxY } = this.bounds
    const bw = Math.max(maxX - minX, 1)
    const bh = Math.max(maxY - minY, 1)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const vw = this.camera.viewportWidth
    const vh = this.camera.viewportHeight

    this.camera.zoom = Math.min(vw / (bw * (1 + PAD * 2)), vh / (bh * (1 + PAD * 2)))
    this.camera.position.x = cx
    this.camera.position.y = cy
    this.camera.update()
  }

  /**
   * 播一段动画。
   * @returns {boolean} 是否真的找到了这段动画（找不到时调用方可以退到别的）
   */
  play(id, animation, { loop = true, track = 0, mix = 0.25 } = {}) {
    const item = this.items.get(id)
    if (!item) return false
    if (!item.data.findAnimation(animation)) return false
    item.state.data.defaultMix = mix
    item.state.setAnimation(track, animation, loop)
    return true
  }

  /** 当前轨道上的动画名（没有则 null） */
  current(id, track = 0) {
    return this.items.get(id)?.state.tracks[track]?.animation?.name || null
  }

  /** 某条轨道是否已经播完（非循环动画用） */
  isComplete(id, track = 0) {
    return this.items.get(id)?.state.tracks[track]?.isComplete?.() ?? false
  }

  /** 这个素材包里有哪些动画 */
  animations(id) {
    return this.items.get(id)?.data.animations.map((a) => a.name) || []
  }

  /** 场景数据（给探针/调试用） */
  inspect() {
    const out = {}
    for (const [id, item] of this.items) {
      out[id] = {
        base: item.base,
        bones: item.data.bones.map((b) => b.name),
        slots: item.data.slots.map((s) => s.name),
        skins: item.data.skins.map((s) => s.name),
        animations: item.data.animations.map((a) => ({ name: a.name, duration: +a.duration.toFixed(3) }))
      }
    }
    return out
  }

  /**
   * 开始渲染循环。
   * @param {(delta:number, elapsed:number)=>void} [onFrame] 每帧回调，用来做时间轴编排
   */
  start(onFrame) {
    if (this.disposed || this.rafId) return
    const loop = (now) => {
      if (this.disposed) return
      const t = now / 1000
      const delta = this.lastTime ? Math.min(t - this.lastTime, 1 / 20) : 1 / 60
      this.lastTime = t

      for (const item of this.items.values()) {
        item.state.update(delta)
        item.state.apply(item.skeleton)
        item.skeleton.updateWorldTransform()
      }
      onFrame?.(delta, t)

      this.renderer.begin()
      for (const id of DRAW_ORDER) {
        const item = this.items.get(id)
        if (item) this.renderer.drawSkeleton(item.skeleton, true)
      }
      this.renderer.end()

      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    for (const item of this.items.values()) {
      for (const page of item.atlas?.pages || []) page.texture?.dispose?.()
      item.atlas?.dispose?.()
    }
    this.items.clear()
    this.renderer?.dispose?.()
    // 主动丢上下文：反复登录/退出会攒下一堆 WebGL 上下文（浏览器上限约 16 个），
    // 到顶之后新画布直接拿不到 context，表现就是"场景突然黑掉"
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

