/**
 * 角色 Q 版形象：全部是**本项目原创绘制的内联 SVG**。
 *
 * 版权说明（重要）：
 *   - 这里只借用角色的通用视觉特征（发色、光环、星形发饰、瞳孔配色），
 *     没有复制任何官方立绘、游戏内素材或同人图。本站为非商业的个人自用站点。
 *   - 想换成自己的图片：把 PNG 放进 public/characters/，
 *     文件名用 hoshino.png / arona.png / plana.png 即可自动替换（见 README）。
 *
 * 比例：画布 128 × 160，头身比约 1 : 1.05（正统 Q 版，不是"大头娃娃"）。
 *   头：椭圆 cx64 cy60 rx35 ry36（约 y24–y96）
 *   身：肩 y110，下摆 y154，肩宽 52
 */

import { svg } from '../lib/utils.js'

/* ---------------- 通用零件 ---------------- */

/** 光环：每人的光环形状不同，这是识别度最高的部件 */
function halo(kind) {
  const cy = 15
  const g = svg('g', { class: 'ch__halo' })
  if (kind === 'hoshino') {
    // 星野：一个大光环 + 一个偏转的小环，粉色
    g.append(
      svg('ellipse', {
        cx: 64, cy, rx: 33, ry: 10, fill: 'none',
        stroke: 'var(--hoshino-deep)', 'stroke-width': 4.5
      }),
      svg('ellipse', {
        cx: 64, cy: 18, rx: 23, ry: 6.5, fill: 'none',
        stroke: 'var(--hoshino)', 'stroke-width': 2.6,
        transform: 'rotate(-10 64 15)'
      })
    )
  } else if (kind === 'arona') {
    // 阿洛娜：细环 + 三个环绕光点（AI 助手感）
    g.append(
      svg('ellipse', {
        cx: 64, cy, rx: 31, ry: 9.5, fill: 'none',
        stroke: 'var(--arona)', 'stroke-width': 4
      }),
      svg('circle', { cx: 33, cy: 11, r: 3.4, fill: 'var(--arona)' }),
      svg('circle', { cx: 95, cy: 13, r: 2.8, fill: 'var(--arona)' }),
      svg('circle', { cx: 64, cy: 4, r: 2.6, fill: 'var(--arona)' })
    )
  } else {
    // 普拉娜：断裂的方框光环
    g.append(
      svg('rect', {
        x: 34, y: 7, width: 60, height: 16, rx: 4, fill: 'none',
        stroke: 'var(--plana)', 'stroke-width': 4, 'stroke-dasharray': '32 11'
      }),
      svg('rect', {
        x: 42, y: 1, width: 44, height: 28, rx: 7, fill: 'none',
        stroke: 'var(--plana)', 'stroke-width': 1.8,
        'stroke-dasharray': '16 20', opacity: 0.6
      })
    )
  }
  return g
}

/** 眼睛：左右分开画，支持异色瞳 */
function eyes(leftColor, rightColor, opts = {}) {
  const { sleepy = false, cy = 66 } = opts
  const g = svg('g', { class: 'ch__eyes' })
  const ry = sleepy ? 6 : 9.2
  for (const [dx, color] of [[-14.5, leftColor], [14.5, rightColor]]) {
    const x = 64 + dx
    g.append(
      svg('ellipse', { cx: x, cy: cy + 0.5, rx: 8, ry: ry + 1.8, fill: '#FFFFFF' }),
      svg('ellipse', { cx: x, cy, rx: 6.6, ry, fill: color }),
      svg('circle', { cx: x - 2.4, cy: cy - 3, r: 2.7, fill: '#FFFFFF', opacity: 0.95 }),
      svg('circle', { cx: x + 2.6, cy: cy + 3.2, r: 1.4, fill: '#FFFFFF', opacity: 0.7 }),
      // 睫毛线，让眼睛有神
      svg('path', {
        d: `M${x - 8.4} ${cy - ry - 1.6} q8.4 -4.6 16.8 0`,
        fill: 'none', stroke: 'var(--text)', 'stroke-width': 1.7,
        'stroke-linecap': 'round', opacity: 0.5
      })
    )
  }
  return g
}

/** 腮红（Q 版必备） */
function blush(cy = 83) {
  return svg('g', { class: 'ch__blush' }, [
    svg('ellipse', { cx: 38, cy, rx: 7.5, ry: 4, fill: 'var(--hoshino)', opacity: 0.4 }),
    svg('ellipse', { cx: 90, cy, rx: 7.5, ry: 4, fill: 'var(--hoshino)', opacity: 0.4 })
  ])
}

/** 嘴：Q 版的 ω 形小嘴 */
function mouth(cy = 87, open = false) {
  if (open) {
    return svg('ellipse', { cx: 64, cy: cy + 1, rx: 5, ry: 5.6, fill: 'var(--hoshino-deep)', opacity: 0.8 })
  }
  return svg('path', {
    d: `M59 ${cy} q2.5 4.4 5 0 q2.5 4.4 5 0`,
    fill: 'none', stroke: 'var(--text)', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.72
  })
}

/** 脸 + 脖子 + 身体（三人共用），身体画在头发之前 */
function body() {
  return [
    // 脖子
    svg('rect', { x: 57, y: 88, width: 14, height: 14, rx: 6, fill: '#F7D9C6' }),
    // 身体：水手服轮廓
    svg('path', {
      d: 'M64 104 C46 104 36 118 35 134 L32 152 H96 L93 134 C92 118 82 104 64 104 Z',
      fill: 'var(--surface-alt)', stroke: 'var(--border)', 'stroke-width': 1.6
    }),
    // 领口
    svg('path', { d: 'M53 106 L64 122 L75 106', fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
    // 领结
    svg('path', { d: 'M64 121 l-7 -4 v9 Z', fill: 'var(--accent)', opacity: 0.85 }),
    svg('path', { d: 'M64 121 l7 -4 v9 Z', fill: 'var(--accent)', opacity: 0.85 }),
    svg('circle', { cx: 64, cy: 121.5, r: 2.6, fill: 'var(--accent-deep)', opacity: 0.9 }),
    // 手臂
    svg('path', { d: 'M37 120 C30 128 29 138 31 146', fill: 'none', stroke: 'var(--border)', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.9 }),
    svg('path', { d: 'M91 120 C98 128 99 138 97 146', fill: 'none', stroke: 'var(--border)', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.9 }),
    // 脸
    svg('ellipse', { cx: 64, cy: 60, rx: 35, ry: 36, fill: '#FDEBE0' })
  ]
}

function base({ label, title }) {
  return svg('svg', {
    viewBox: '0 0 128 160',
    role: 'img',
    'aria-label': label,
    class: 'ch__svg'
  }, title ? [svg('title', {}, title)] : null)
}

/* ---------------- 小鸟游星野（主讲述人） ---------------- */

export function hoshinoSVG() {
  const root = base({ label: 'Q 版星野形象', title: '小鸟游星野（Q 版原创绘制）' })
  root.append(
    // 后层头发：粉色长发
    svg('path', {
      d: 'M64 20 C40 20 27 38 27 62 C27 84 24 104 21 152 L41 152 C41 122 41 96 41 74 L87 74 C87 96 87 122 87 152 L107 152 C104 104 101 84 101 62 C101 38 88 20 64 20 Z',
      fill: 'var(--hoshino)'
    }),
    // 发梢加深，做出层次
    svg('path', { d: 'M21 152 C24 104 27 84 27 62 L41 74 C41 96 41 122 41 152 Z', fill: 'var(--hoshino-deep)', opacity: 0.42 }),
    svg('path', { d: 'M107 152 C104 104 101 84 101 62 L87 74 C87 96 87 122 87 152 Z', fill: 'var(--hoshino-deep)', opacity: 0.42 }),
    // 呆毛
    svg('path', { d: 'M64 20 C61 8 68 3 75 6 C70 9 67 14 67 20', fill: 'var(--hoshino)' }),
    ...body(),
    // 刘海：三束
    svg('path', {
      d: 'M29 62 C29 28 44 17 64 17 C84 17 99 28 99 62 C93 44 85 36 76 50 C69 36 59 36 52 50 C43 36 35 44 29 62 Z',
      fill: 'var(--hoshino)'
    }),
    svg('path', { d: 'M29 62 C31 44 38 33 47 27 C40 40 35 51 35 64 Z', fill: 'var(--hoshino-deep)', opacity: 0.34 }),
    // 星形发饰（星野的标识）
    svg('path', {
      d: 'M95 42 l4 8.4 9.2 1.3 -6.7 6.5 1.6 9.2 -8.1 -4.3 -8.1 4.3 1.6 -9.2 -6.7 -6.5 9.2 -1.3 Z',
      fill: 'var(--star)', stroke: 'var(--hoshino-deep)', 'stroke-width': 1.4
    }),
    // 五官：异色瞳（左琥珀右蓝）+ 睡眼
    eyes('#F0A93F', '#5AB0EE', { sleepy: true, cy: 66 }),
    blush(),
    mouth(88)
  )
  root.prepend(halo('hoshino'))
  return root
}

/* ---------------- 阿洛娜（挂件 / 系统助手） ---------------- */

export function aronaSVG() {
  const root = base({ label: 'Q 版阿洛娜形象', title: '阿洛娜（Q 版原创绘制）' })
  root.append(
    // 后层头发：蓝白短发
    svg('path', {
      d: 'M64 18 C41 18 29 36 29 60 C29 80 27 92 33 106 C35 92 37 82 37 70 L91 70 C91 82 93 92 95 106 C101 92 99 80 99 60 C99 36 87 18 64 18 Z',
      fill: 'var(--arona)'
    }),
    svg('path', { d: 'M29 60 C29 36 41 18 64 18 C57 32 46 44 44 68 Z', fill: '#FFFFFF', opacity: 0.4 }),
    ...body(),
    // 刘海：整齐的圆弧
    svg('path', {
      d: 'M30 66 C30 30 45 17 64 17 C83 17 98 30 98 66 C94 48 87 38 77 38 C69 38 64 46 64 55 C64 46 59 38 51 38 C41 38 34 48 30 66 Z',
      fill: 'var(--arona)'
    }),
    // 两侧短发
    svg('path', { d: 'M30 62 C26 78 28 92 34 100 C30 86 32 72 34 62 Z', fill: 'var(--arona)' }),
    svg('path', { d: 'M98 62 C102 78 100 92 94 100 C98 86 96 72 94 62 Z', fill: 'var(--arona)' }),
    // 蝴蝶结发饰
    svg('g', {}, [
      svg('path', { d: 'M93 34 l13 -7 v14 Z', fill: '#FFFFFF', stroke: 'var(--arona)', 'stroke-width': 1.6 }),
      svg('path', { d: 'M93 34 l13 7 v-14 Z', fill: '#FFFFFF', stroke: 'var(--arona)', 'stroke-width': 1.6 }),
      svg('circle', { cx: 93, cy: 34, r: 3, fill: 'var(--arona)' })
    ]),
    eyes('#4FA9E8', '#4FA9E8', { cy: 66 }),
    blush(),
    mouth(88)
  )
  root.prepend(halo('arona'))
  return root
}

/* ---------------- 普拉娜（挂件 / 安静的那位） ---------------- */

export function planaSVG() {
  const root = base({ label: 'Q 版普拉娜形象', title: '普拉娜（Q 版原创绘制）' })
  root.append(
    // 后层头发：灰白长发
    svg('path', {
      d: 'M64 18 C40 18 27 38 27 64 C27 88 23 108 22 154 L42 154 C42 124 42 98 42 76 L86 76 C86 98 86 124 86 154 L106 154 C105 108 101 88 101 64 C101 38 88 18 64 18 Z',
      fill: 'var(--plana)'
    }),
    svg('path', { d: 'M22 154 C23 108 27 88 27 64 L42 76 C42 98 42 124 42 154 Z', fill: '#8E9AC6', opacity: 0.38 }),
    svg('path', { d: 'M106 154 C105 108 101 88 101 64 L86 76 C86 98 86 124 86 154 Z', fill: '#8E9AC6', opacity: 0.38 }),
    ...body(),
    // 刘海：偏分，略带凌乱
    svg('path', {
      d: 'M30 64 C30 30 45 17 64 17 C84 17 98 33 98 64 C95 44 88 36 78 43 C69 49 61 39 51 41 C41 43 34 51 30 64 Z',
      fill: 'var(--plana)'
    }),
    svg('path', { d: 'M30 64 C32 46 37 35 45 29 C39 42 35 53 35 66 Z', fill: '#8E9AC6', opacity: 0.34 }),
    // 分缝线（识别点）
    svg('path', { d: 'M64 17 C75 22 83 32 85 45', fill: 'none', stroke: '#8E9AC6', 'stroke-width': 1.8, opacity: 0.55 }),
    // 五官：冷静的半睁眼
    eyes('#7F8FC4', '#7F8FC4', { sleepy: true, cy: 66 }),
    svg('g', { opacity: 0.3 }, [
      svg('ellipse', { cx: 38, cy: 84, rx: 7, ry: 3.6, fill: 'var(--plana)' }),
      svg('ellipse', { cx: 90, cy: 84, rx: 7, ry: 3.6, fill: 'var(--plana)' })
    ]),
    mouth(89)
  )
  root.prepend(halo('plana'))
  return root
}

export const CHARACTERS = [
  { id: 'hoshino', name: '小鸟游星野', role: '主讲述人 · 前辈', color: 'var(--hoshino)', svg: hoshinoSVG },
  { id: 'arona', name: '阿洛娜', role: '系统助手', color: 'var(--arona)', svg: aronaSVG },
  { id: 'plana', name: '普拉娜', role: '安静的那位', color: 'var(--plana)', svg: planaSVG }
]

export function characterById(id) {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0]
}

/**
 * 自定义形象的状态表。
 * 之前是每次渲染都无条件往 characters/<id>.png 发请求，文件不存在时浏览器
 * 控制台会刷一条 404 —— 每个用户每次打开都有，很误导。改成：
 * 先探测一次，探到就缓存下来，探不到就永远不再请求。
 */
const customImageState = new Map() // id -> undefined 未探测 | string url 有 | null 没有

// 站点根路径。用 baseURI 而不是相对路径，避免在带路径的 URL 下解析错位置。
// （baseURI 只反映页面加载时的 base，所以进 SPA 子路由也不会被带偏。）
function assetUrl(relative) {
  try {
    return new URL(relative, document.baseURI).href
  } catch {
    return relative
  }
}

/** 探测一次自定义图片是否存在。用 fetch 而不是 <img>，因为失败的 <img> 会往控制台写 404。 */
function probeCustomImage(id) {
  if (customImageState.has(id)) return Promise.resolve(customImageState.get(id))
  const url = assetUrl(`characters/${id}.png`)
  return fetch(url, { method: 'GET', cache: 'force-cache' })
    .then((res) => {
      // 注意：静态站点对不存在的路径常返回 200 + HTML（GitHub Pages 的 404 页），
      // 所以要连 content-type 一起判断，不能只看状态码。
      const type = res.headers.get('content-type') || ''
      const ok = res.ok && type.startsWith('image/')
      customImageState.set(id, ok ? url : null)
      return customImageState.get(id)
    })
    .catch(() => {
      customImageState.set(id, null)
      return null
    })
}

/**
 * 角色挂件：带"呼吸"漂浮动画的小形象。
 * 若 public/characters/<id>.png 存在，会自动改用那张图（用户自定义替换）。
 * 不存在就用内置的自绘 SVG，且不产生任何失败请求。
 */
export function mascot(id, { size = 104, float = true } = {}) {
  const char = characterById(id)
  const wrap = document.createElement('div')
  wrap.className = `mascot mascot--${id}${float ? ' mascot--float' : ''}`
  wrap.style.setProperty('--mascot-size', `${size}px`)

  const svgNode = char.svg()
  wrap.append(svgNode)

  probeCustomImage(id).then((url) => {
    if (!url) return
    const img = document.createElement('img')
    img.className = 'mascot__img'
    img.alt = `${char.name}（自定义形象）`
    img.src = url
    img.addEventListener('load', () => {
      // 只在图片真的解码成功后才替换掉 SVG
      svgNode.setAttribute('hidden', '')
      wrap.prepend(img)
    })
    img.addEventListener('error', () => img.remove())
  })

  return wrap
}
