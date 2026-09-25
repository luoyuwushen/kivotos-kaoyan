/**
 * 开发用探针页（**不是给用户看的**）
 * ------------------------------------------------------------------
 * URL 上加 `#scene` 打开。它把场景真跑起来，然后把骨架结构（骨骼 / 插槽 / 皮肤 /
 * 动画清单）打在页面上，方便一边看渲染效果一边确认"有哪些动画可以编排"。
 *
 * 用在移植阶段：Spine 里到底有哪些动画名，只有真读出来才知道。
 * 移植做完之后如果不需要了，把 main.js 里那一行路由删掉即可。
 */

import { el } from '../lib/utils.js'
import { SceneStage, SCENES } from '../lib/scene-stage.js'

export function renderSceneProbe(ctx) {
  const canvas = el('canvas', {
    style: {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      background: '#0b1a2b'
    }
  })
  const status = el('pre', {
    style: {
      position: 'fixed',
      left: '12px',
      top: '12px',
      right: '12px',
      maxHeight: '46vh',
      overflow: 'auto',
      margin: '0',
      padding: '12px 14px',
      borderRadius: '10px',
      background: 'rgba(4,16,28,0.82)',
      color: '#cfe6ff',
      font: '12px/1.6 ui-monospace, Consolas, monospace',
      whiteSpace: 'pre-wrap',
      zIndex: '10'
    }
  }, '正在加载场景…')
  const bar = el('div', {
    style: {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      right: '12px',
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      zIndex: '11'
    }
  })

  const wrap = el('div', {}, [canvas, status, bar])
  let stage = null

  const log = (line) => {
    status.textContent += '\n' + line
  }

  // 给自动化测试留一个把手：查机位、量取景、切动画都能从这里进
  window.__scene = {
    ready: false,
    error: null,
    /** 骨架结构与取景的诊断数字 */
    diag() {
      if (!stage) return null
      const content = stage.contentBounds()
      return {
        scene: stage.scene,
        items: [...stage.items.keys()],
        content,
        camera: stage.viewportRect(),
        bounds: stage.bounds
      }
    },
    /** 直接指定取景框 */
    fit(box) {
      stage?.fitTo(box)
    },
    /**
     * 临时改画布尺寸（标定用）。
     *
     * 为什么要这个：WebGL 的 drawingBuffer 一交给合成器就被清空，
     * 所以想拿像素必须走 `snapshot()`（内部同步 `drawOnce()` + `toDataURL()`）——
     * 而 `toDataURL` 的开销随画布面积走。扫参数时需要成百次抓帧，
     * 把画布临时缩到 120×68 能把单次从几秒降到几十毫秒。
     */
    setCanvasSize(w, h) {
      if (!stage) return
      stage.sizeOverride = [Math.max(1, w), Math.max(1, h)]
      stage.resize()
      return [stage.canvas.width, stage.canvas.height]
    },
    /** 解除尺寸锁定，恢复按 CSS 自适应 */
    clearCanvasSize() {
      if (!stage) return
      stage.sizeOverride = null
      stage.resize()
      return [stage.canvas.width, stage.canvas.height]
    },
    /**
     * 闭环标定机位：渲染 → 读像素求内容包围盒 → 反推世界坐标 → 再调机位。
     * 这是「内容到底画在哪儿」唯一可靠的答案 —— 坐标推算在这套素材上不准。
     */
    fitToContent(iterations) {
      return stage?.fitToContent({ iterations: iterations ?? 3 }) || null
    },
    /** 量当前这一帧的内容包围盒（像素坐标） */
    measure() {
      const url = stage?.snapshot?.()
      if (!url) return null
      const canvas = stage.canvas
      // measureOpaque 不在这个作用域里，直接内联一份最小实现
      const c = document.createElement('canvas')
      c.width = canvas.width
      c.height = canvas.height
      const ctx = c.getContext('2d', { willReadFrequently: true })
      const img = new Image()
      img.src = url
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let minX = canvas.width
      let minY = canvas.height
      let maxX = -1
      let maxY = -1
      let count = 0
      for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
          if (d[(y * canvas.width + x) * 4 + 3] < 10) continue
          count++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
      if (maxX < 0) return { count: 0 }
      return {
        count,
        minX,
        minY,
        maxX,
        maxY,
        widthPct: Math.round(((maxX - minX) / canvas.width) * 100),
        heightPct: Math.round(((maxY - minY) / canvas.height) * 100)
      }
    },
    play(id, name, loop) {
      return stage?.play(id, name, { loop })
    },
    animations(id) {
      return stage?.animations(id) || []
    },
    /** 只显示某几个 id（用来逐个定位部件） */
    only(ids) {
      if (!stage) return
      stage.hidden = new Set([...stage.items.keys()].filter((k) => !ids.includes(k)))
    },
    /**
     * 插槽颜色体检：精灵几乎透明时看这里。
     *
     * Spine 顶点的最终 alpha = 贴图 alpha × 插槽色 a × 顶点色 a。
     * 如果插槽色被解析成极小的值（把 0-255 当成 0-1 用、或反之），
     * 画出就会是「有色但几乎全透明」—— 存成 PNG 后 alpha 极值只有个位数。
     */
    colors(id) {
      const item = stage?.items.get(id || 'arona') || [...(stage?.items.values() || [])].pop()
      if (!item) return null
      const out = []
      for (const slot of item.skeleton.slots) {
        const c = slot.color
        out.push({ slot: slot.name, a: +c.a.toFixed(4) })
      }
      const attached = []
      for (const slot of item.skeleton.slots) {
        if (!slot.getAttachment()) continue
        attached.push({ slot: slot.name, a: +slot.color.a.toFixed(4) })
      }
      return {
        total: out.length,
        alphaStats: {
          min: Math.min(...out.map((o) => o.a)),
          max: Math.max(...out.map((o) => o.a)),
          tiny: out.filter((o) => o.a < 0.01).length
        },
        sample: out.slice(0, 6),
        attached: attached.slice(0, 12)
      }
    },
    /** 线框模式：只看骨骼与附件轮廓 */
    debug(on) {
      if (stage) stage.debugDraw = Boolean(on)
    },
    /** 场景编排表（供验收脚本对照官方 render_still 的输出） */
    sceneNames() {
      return Object.keys(SCENES)
    },
    sceneSpec(name) {
      return SCENES[name] || null
    },
    /** 按原版编排起播一幕（三轨叠加） */
    playScene(name) {
      return stage?.playScene?.(name) || null
    },
    /** 点击角色：播对应的 Touch 动画，播完自动回待机 */
    poke(kind) {
      return stage?.poke?.(kind) || null
    },
    /**
     * 换一个几何缩放档位（`SkeletonBinary.scale`）并重新加载。
     *
     * 这是标定「整体尺寸」的唯一有效旋钮 —— 改 `atlas.scale` 是没用的（实测几何不动）。
     * 用它扫几档，配合 `measure()` 的量化指标挑出人物比例正常的那一档。
     */
    async setScale(k) {
      if (!stage) return null
      const canvas = stage.canvas
      const scene = stage.scene
      const hidden = new Set(stage.hidden || [])
      // 注意：这里**不能**调 stage.dispose()。
      // 贴图和骨架都挂在 AssetManager 上，dispose 会把它们释放掉，
      // 而 AssetManager 自己的 dispose 逻辑对已释放资源会抛
      // `Cannot read properties of undefined (reading 'dispose')`。
      // 标定只需换个尺重新加载，直接把旧 stage 丢给 GC 即可。
      stage.stop?.()
      stage.disposed = true
      const next = new SceneStage(canvas, { scene })
      next.skeletonScale = Number(k)
      await next.load()
      next.hidden = hidden
      stage = next
      window.__scene.ready = true
      return { scale: next.skeletonScale, items: [...next.items.keys()] }
    },
    /**
     * 把「画出来用的顶点」抓出来看：位置 + 颜色。
     *
     * Spine 的最终顶点色 = 插槽色 × 顶点色（dark color）。
     * 如果 alpha 在这里就已经接近 0，那么无论贴图多正常，画出来都是几乎透明的 ——
     * 这正是当前现象（存成 PNG 后 alpha 极值只有个位数）。
     * 位置一并带出来，方便看它是不是画到了该画的地方。
     */
    vertices(id) {
      const item = stage?.items.get(id || 'arona')
      if (!item) return null
      const { RegionAttachment, MeshAttachment } = stage.core
      const sk = item.skeleton
      const out = []
      for (const slot of sk.slots) {
        const a = slot.getAttachment()
        if (!a) continue
        let n = 0
        if (a instanceof RegionAttachment) n = 4
        else if (a instanceof MeshAttachment) n = (a.worldVerticesLength || 0) / 2
        else continue
        if (!n) continue
        const world = new Float32Array((a.worldVerticesLength || n * 2) + 8)
        try {
          if (a instanceof RegionAttachment) a.computeWorldVertices(slot, world, 0, 2)
          else a.computeWorldVertices(slot, 0, a.worldVerticesLength, world, 0, 2)
        } catch {
          continue
        }
        out.push({
          slot: slot.name,
          type: a.constructor.name,
          verts: n,
          slotColor: [+slot.color.r.toFixed(3), +slot.color.g.toFixed(3), +slot.color.b.toFixed(3), +slot.color.a.toFixed(3)],
          firstWorld: [+world[0].toFixed(1), +world[1].toFixed(1)],
          uvMin: a.uvs ? +Math.min(...a.uvs).toFixed(3) : null,
          uvMax: a.uvs ? +Math.max(...a.uvs).toFixed(3) : null
        })
        if (out.length >= 10) break
      }
      return out
    },
    /**
     * 双色染色开关。
     *
     * SceneRenderer 构造时的第三个参数 `twoColorTint` 会改变**顶点布局**：
     * 开启时每个顶点多带一组颜色。如果骨架用了 rgb2/rgb 时间线（Spine 4.2 的双色染色）
     * 而渲染器按单色解析，UV 就会被读成别的字段 ——
     * 表现正是「顶点位置全对、纹理却贴错/发白」，和现在看到的现象完全吻合。
     */
    twoColorTint(on) {
      if (!stage) return
      const { SceneRenderer } = stage.webgl
      stage.renderer.dispose?.()
      stage.renderer = new SceneRenderer(stage.canvas, stage.glContext, Boolean(on))
      stage.twoColorTint = Boolean(on)
    },
    /**
     * 把附件的真实 UV 数据拿出来看。
     *
     * 这是判断「问题在数据还是在渲染」的分水岭：
     *   · UV 落在 [0,1] 且互不相同 → 数据是对的，问题在渲染（顶点布局/混合/贴图绑定）
     *   · UV 全是 0 或明显越界 → 数据解析就错了，问题在 SkeletonBinary 这条路
     */
    uvs(id) {
      if (!stage) return null
      const item = stage.items.get(id)
      if (!item) return null
      const { RegionAttachment, MeshAttachment } = stage.core
      const out = { region: [], mesh: [], counts: { region: 0, mesh: 0 } }
      for (const slot of item.skeleton.slots) {
        const a = slot.getAttachment()
        if (!a) continue
        if (a instanceof RegionAttachment) {
          out.counts.region++
          if (out.region.length < 3) {
            out.region.push({
              slot: slot.name,
              uvs: Array.from(a.uvs || []).map((v) => +v.toFixed(4)),
              offset: Array.from(a.offset || []).map((v) => +v.toFixed(1))
            })
          }
        } else if (a instanceof MeshAttachment) {
          out.counts.mesh++
          if (out.mesh.length < 3) {
            const uvs = Array.from(a.uvs || [])
            out.mesh.push({
              slot: slot.name,
              uvCount: uvs.length,
              first8: uvs.slice(0, 8).map((v) => +v.toFixed(4)),
              min: uvs.length ? +Math.min(...uvs).toFixed(4) : null,
              max: uvs.length ? +Math.max(...uvs).toFixed(4) : null
            })
          }
        }
      }
      return out
    },
    /**
     * 同步画一帧并把 canvas 取出来（dataURL）。
     * 实现在 SceneStage 上（机位闭环标定也要用），这里只做转发。
     *
     * @returns {string} dataURL（失败时是空串）
     */
    snapshot() {
      return stage?.snapshot?.() || ''
    },
    /** 这一帧一共提交了多少顶点（判断 draw 到底有没有发生） */
    stats() {
      const gl = stage?.gl
      if (!gl || gl.__probeWrapped) return gl?.__probeStats || null
      // 包一层 draw 调用计数：这是"几何到底有没有送进 GL"最直接的证据
      gl.__probeStats = { drawElements: 0, drawArrays: 0, indices: 0, vertices: 0 }
      gl.__probeWrapped = true
      const de = gl.drawElements.bind(gl)
      gl.drawElements = (mode, count, type, offset) => {
        gl.__probeStats.drawElements++
        gl.__probeStats.indices += count
        return de(mode, count, type, offset)
      }
      const da = gl.drawArrays.bind(gl)
      gl.drawArrays = (mode, first, count) => {
        gl.__probeStats.drawArrays++
        gl.__probeStats.vertices += count
        return da(mode, first, count)
      }
      return gl.__probeStats
    },
    /** 重置 draw 计数，然后画一帧，返回本次统计 */
    countFrame() {
      const gl = stage?.gl
      if (!gl) return null
      window.__scene.stats()
      gl.__probeStats.drawElements = 0
      gl.__probeStats.drawArrays = 0
      gl.__probeStats.indices = 0
      gl.__probeStats.vertices = 0
      stage.drawOnce()
      return { ...gl.__probeStats }
    },
    /**
     * 资产与 GL 状态体检 —— 专门用来回答「画面为什么是空的」。
     *
     *   · 贴图有没有真的加载出来（尺寸 / 是否 0×0）
     *   · 图集里到底有多少 region、附件有没有挂上 region
     *   · WebGL 有没有报错（GL_INVALID_* 会让 draw 静默失败，控制台什么都不说）
     */
    health() {
      if (!stage) return null
      const gl = stage.gl
      const glErrors = []
      let e
      while ((e = gl.getError()) !== gl.NO_ERROR) glErrors.push(e)

      const out = { glErrors, textures: [], regions: {}, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) }
      for (const [id, item] of stage.items) {
        for (const page of item.atlas.pages) {
          const tex = page.texture
          const img = tex?.getImage?.()
          out.textures.push({
            atlas: item.base,
            page: page.name,
            atlasPageSize: `${page.width}x${page.height}`,
            image: img ? `${img.width}x${img.height}` : '（没有图）',
            glTexture: Boolean(tex?.glTexture)
          })
        }
        let withRegion = 0
        let withoutRegion = 0
        for (const slot of item.skeleton.slots) {
          const a = slot.getAttachment()
          if (!a) continue
          if (a.region) withRegion++
          else withoutRegion++
        }
        out.regions[id] = {
          atlasRegions: item.atlas.regions.length,
          attachmentsWithRegion: withRegion,
          attachmentsWithoutRegion: withoutRegion
        }
      }
      return out
    },
    /**
     * 骨架的骨骼世界范围 + 附件世界范围分开报。
     * 两者的差距能说明「机位是被什么撑大的」。
     */
    extents() {
      if (!stage) return null
      const out = {}
      for (const [id, item] of stage.items) {
        const sk = item.skeleton
        let bMinX = Infinity
        let bMinY = Infinity
        let bMaxX = -Infinity
        let bMaxY = -Infinity
        for (const b of sk.bones) {
          bMinX = Math.min(bMinX, b.worldX)
          bMaxX = Math.max(bMaxX, b.worldX)
          bMinY = Math.min(bMinY, b.worldY)
          bMaxY = Math.max(bMaxY, b.worldY)
        }
        out[id] = {
          bones: { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY },
          skeleton: { x: sk.x, y: sk.y, scaleX: sk.scaleX, scaleY: sk.scaleY },
          slotCount: sk.slots.length
        }
      }
      return out
    },
    stage: () => stage
  }

  const boot = async () => {
    try {
      // 动态 import：探针页本身不该把 170KB 的 spine 运行时带进主包
      stage = new SceneStage(canvas, { scene: 'office-day' })
      await stage.load()
      stage.start()

      const info = stage.inspect()
      const content = stage.contentBounds()
      const cam = stage.viewportRect()
      const lines = [
        `WebGL: ${stage.gl?.getParameter(stage.gl.VERSION)}`,
        `骨架：${Object.keys(info).join(', ')}`,
        ''
      ]
      for (const [id, s] of Object.entries(info)) {
        lines.push(`── ${id}（${s.base}）`)
        lines.push(
          `   骨骼 ${s.bones.length} · 插槽 ${s.slots.length} · 皮肤 ${s.skins.length} · 动画 ${s.animations.length} · 物理约束 ${s.physics}`
        )
        lines.push('   动画：' + s.animations.map((a) => `${a.name}(${a.duration}s)`).join('  '))
        lines.push('')
      }
      lines.push('内容包围盒：' + (content ? JSON.stringify(content, (k, v) => (typeof v === 'number' ? +v.toFixed(1) : v)) : '量不出来'))
      lines.push('当前取景框：' + (cam ? JSON.stringify(cam, (k, v) => (typeof v === 'number' ? +v.toFixed(1) : v)) : '—'))
      status.textContent = lines.join('\n')
      window.__scene.ready = true

      // 每个动画各给一个按钮，点一下就能看效果 —— 编排之前先眼看一遍
      for (const id of Object.keys(info)) {
        const names = info[id].animations.map((a) => a.name)
        bar.append(
          el('span', { style: { color: '#9fc4e8', font: '12px ui-monospace' } }, `${id}: `),
          ...names.slice(0, 40).map((name) =>
            el(
              'button',
              {
                type: 'button',
                style: {
                  font: '11px ui-monospace',
                  padding: '3px 7px',
                  borderRadius: '6px',
                  border: '1px solid rgba(160,200,240,.4)',
                  background: 'rgba(8,30,52,.75)',
                  color: '#dcecff',
                  cursor: 'pointer'
                },
                onClick: () => {
                  const loop = /Idle|background/i.test(name)
                  const ok = stage.play(id, name, { loop })
                  log(`▶ ${id} / ${name} → ${ok ? (loop ? '循环' : '播放一次') : '找不到'}`)
                }
              },
              name
            )
          )
        )
      }
      window.addEventListener('resize', () => stage.relayout())
    } catch (err) {
      window.__scene.error = err.message
      status.textContent = `场景加载失败：${err.message}\n\n${err.stack || ''}`
      console.error('[scene-probe]', err)
    }
  }

  ctx.onDestroy?.(() => {
    stage?.dispose()
    stage = null
  })

  boot()
  return wrap
}
