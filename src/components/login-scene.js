import { el } from '../lib/utils.js'
import { sceneForHour } from '../lib/scene-time.js'

const asset = (name) => new URL(`shittim/${name}`, document.baseURI).href

/** 登录视图拥有场景、监听器和过场；离开视图时一起释放。 */
export function createLoginScene() {
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const canvas = el('canvas', {
    class: 'login-scene__canvas',
    'aria-hidden': 'true',
    dataset: { testid: 'login-scene-canvas' }
  })
  const poster = el('img', { class: 'login-scene__poster', alt: '', 'aria-hidden': 'true' })
  const status = el('span', { class: 'login-scene__status', role: 'status' }, '阿洛娜正在准备教室…')
  const poke = el('button', {
    type: 'button', class: 'login-scene__poke', disabled: true,
    dataset: { testid: 'scene-poke' }, 'aria-label': '和阿洛娜打招呼',
    onClick: () => {
      if (!motion.matches) stage?.poke('A')
    }
  }, '和阿洛娜打招呼')
  const node = el('section', {
    class: 'login-scene', 'aria-label': '阿洛娜的教室', dataset: { state: 'loading' }
  }, [poster, canvas, el('div', { class: 'login-scene__bar' }, [status, poke])])

  let stage = null
  let disposed = false
  let ready = false
  let mountFrame = 0
  let loadTimeout = 0
  let hourTimer = 0
  let sceneName = sceneForHour()
  let entryImage = null
  let finishEntry = null
  let entryAnimation = null
  let entryOverlay = null
  let entering = false

  // 不等 Spine 模块下载；它失败时也能显示与本地时间对应的同幕静态图。
  node.dataset.scene = sceneName
  poster.src = asset(`thumb-${sceneName}.png`)

  function preloadSplash() {
    entryImage = new Image()
    entryImage.src = asset(sceneName.startsWith('day_') ? 'enter_splash_day.png' : 'enter_splash.png')
  }
  preloadSplash()

  function fallback() {
    if (disposed) return
    ready = false
    node.dataset.state = 'fallback'
    status.textContent = '欢迎回来，Sensei。'
    poke.hidden = true
    stage?.dispose()
  }

  function syncPlayback() {
    if (!ready || disposed || entering) return
    stage.stop()
    poke.hidden = motion.matches
    if (!document.hidden) {
      stage.drawOnce()
      if (!motion.matches) stage.start()
    }
  }

  function resize() {
    if (!ready || disposed) return
    stage.resize()
    stage.drawOnce()
  }

  const observer = new ResizeObserver(resize)
  const contextLost = () => fallback()
  canvas.addEventListener('webglcontextlost', contextLost)
  // 点击场景与键盘按钮使用同一条动画入口。
  canvas.addEventListener('click', () => {
    if (ready && !entering && !motion.matches) stage?.poke('A')
  })
  poster.addEventListener('error', () => { poster.hidden = true })

  async function mount() {
    // 等 DOM 挂上，首帧再读 CSS 尺寸，避免用默认 300×150 初始化机位。
    mountFrame = requestAnimationFrame(async () => {
      if (disposed) return
      observer.observe(node)
      document.addEventListener('visibilitychange', syncPlayback)
      motion.addEventListener('change', syncPlayback)
      try {
        const { SceneStage, SCENES } = await import('../lib/scene-stage.js')
        if (disposed) return
        sceneName = sceneForHour()
        node.dataset.scene = sceneName
        poster.src = asset(`thumb-${sceneName}.png`)
        preloadSplash()
        stage = new SceneStage(canvas, { scene: SCENES[sceneName].room })
        loadTimeout = setTimeout(fallback, 12000)
        await stage.load()
        clearTimeout(loadTimeout)
        if (disposed || stage.disposed) return
        stage.playScene(sceneName)
        stage.update(0)
        ready = true
        resize()
        node.dataset.state = 'ready'
        status.textContent = sceneName.startsWith('day_') ? '日光下的教室' : '夜色中的教室'
        poke.disabled = false
        syncPlayback()
        // 页面长时间停在登录屏时，也随本地时间切换；后台不下载另一套素材。
        hourTimer = setInterval(async () => {
          const next = sceneForHour()
          if (disposed || entering || document.hidden || next === sceneName) return
          try {
            await stage.ensureRoom(SCENES[next].room)
            if (disposed || entering || stage.disposed) return
            sceneName = next
            stage.playScene(next)
            stage.update(0)
            node.dataset.scene = next
            poster.src = asset(`thumb-${next}.png`)
            status.textContent = next.startsWith('day_') ? '日光下的教室' : '夜色中的教室'
            preloadSplash()
            resize()
          } catch { /* 换幕失败时保留当前教室，下分钟重试。 */ }
        }, 60000)
      } catch {
        clearTimeout(loadTimeout)
        fallback()
      }
    })
  }

  function enter(root) {
    if (disposed || entering) return Promise.resolve()
    entering = true
    clearInterval(hourTimer)
    stage?.stop()
    // 认证已完成时不再需要等待教室贴图；停止未完成的下载与 GPU 上传。
    if (!ready) stage?.dispose()
    const duration = motion.matches ? 180 : 1500
    entryOverlay = el('div', {
      class: 'login-entry', role: 'status', 'aria-live': 'polite',
      dataset: { testid: 'login-entry' }
    }, [
      el('img', { class: 'login-entry__image', src: entryImage?.src || asset('enter_splash_day.png'), alt: '' }),
      el('p', { class: 'login-entry__message' }, '正在进入作战本部…')
    ])
    root.append(entryOverlay)
    return new Promise((resolve) => {
      // 不依赖 animationend：背景标签页、减少动态效果和动画被取消都必须能进入。
      let timer
      finishEntry = () => {
        clearTimeout(timer)
        finishEntry = null
        resolve()
      }
      timer = setTimeout(() => finishEntry?.(), duration + 250)
      try {
        entryAnimation = entryOverlay.animate(
          motion.matches
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.38 }, { opacity: 1, offset: 1 }],
          { duration, easing: 'ease-out', fill: 'forwards' }
        )
        entryAnimation.finished.then(() => finishEntry?.(), () => finishEntry?.())
      } catch {
        // 没有 Web Animations API 时，仍显示短暂的进入画面，由上面的计时器收尾。
      }
    })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    clearTimeout(loadTimeout)
    clearInterval(hourTimer)
    cancelAnimationFrame(mountFrame)
    observer.disconnect()
    motion.removeEventListener('change', syncPlayback)
    document.removeEventListener('visibilitychange', syncPlayback)
    canvas.removeEventListener('webglcontextlost', contextLost)
    entryAnimation?.cancel()
    finishEntry?.()
    entryOverlay?.remove()
    stage?.dispose()
  }

  return { node, mount, enter, dispose }
}
