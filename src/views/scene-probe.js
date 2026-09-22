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

  const boot = async () => {
    try {
      // 动态 import：探针页本身不该把 170KB 的 spine 运行时带进主包
      const { SceneStage } = await import('../lib/scene-stage.js')
      stage = new SceneStage(canvas, { scene: 'office-day' })
      await stage.load()
      stage.start()

      const info = stage.inspect()
      const lines = [`WebGL: ${stage.gl?.getParameter(stage.gl.VERSION)}`, '']
      for (const [id, s] of Object.entries(info)) {
        lines.push(`── ${id}（${s.base}）`)
        lines.push(`   骨骼 ${s.bones.length} · 插槽 ${s.slots.length} · 皮肤 ${s.skins.length} · 动画 ${s.animations.length}`)
        lines.push(`   插槽：${s.slots.join(', ')}`)
        lines.push('   动画：')
        for (const a of s.animations) lines.push(`     ${a.name.padEnd(46)} ${a.duration}s`)
        lines.push('')
      }
      status.textContent = lines.join('\n')

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
      window.addEventListener('resize', () => stage.resize())
    } catch (err) {
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
