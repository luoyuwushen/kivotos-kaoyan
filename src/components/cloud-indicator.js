/**
 * 侧栏 / 底栏上的云端同步状态指示。
 *
 * 为什么要单独一个模块：
 *   1. 云端是**可选**的。没配置后端时这个入口完全不出现（连一次网络请求都不发），
 *      所以它的所有逻辑都必须先过 isCloudConfigured() 这一关。
 *   2. 它由 buildShell() 建一次就不重建了，所以不能用「整个应用重绘」那套来刷新 ——
 *      那样等于每次同步状态变化都重画页面，还会和设置页的订阅互相触发。
 *      这里改成：只订阅一次，回调里直接改这一个节点的文字与颜色。
 *   3. 登录身份用 watchSession（按 user_id 去重）而不是 SDK 的认证事件 ——
 *      SDK 每次订阅都会立刻派发一次 INITIAL_SESSION，无脑响应会变成自激循环。
 */

import { el } from '../lib/utils.js'
import { icon } from './icons.js'
import {
  isCloudConfigured,
  onCloudStatus,
  cloudStatus,
  watchSession,
  cloudMeta
} from '../lib/cloud.js'

let started = false

/** 状态文案：优先显示「正在同步/出错」，空闲时显示登录状态 */
function describe(status, user) {
  if (status.state === 'busy') return '同步中…'
  if (status.state === 'error') return '同步失败'
  if (status.state === 'conflict') return '需要选择'
  if (user) {
    // 同步正常时顺带把邮箱露出来一点，方便确认「登录的是哪个账号」
    const email = user.email || cloudMeta().email || ''
    const short = email.length > 18 ? `${email.slice(0, 16)}…` : email
    return short ? `已连接 ${short}` : '已连接云端'
  }
  return '未登录云端'
}

function stateOf(status, user) {
  if (status.state === 'busy' || status.state === 'error' || status.state === 'conflict') {
    return status.state
  }
  return user ? 'synced' : 'off'
}

/**
 * 往侧栏挂一个云端状态入口。
 * @param {HTMLElement} sidenav 导航容器（桌面是侧栏，手机是底部标签栏）
 */
export function mountCloudIndicator(sidenav) {
  if (started || !isCloudConfigured()) return null
  started = true

  const text = el('span', { class: 'nav-cloud__text' }, '检查云端…')
  const node = el(
    'button',
    {
      class: 'nav-cloud',
      type: 'button',
      dataset: { state: 'idle', testid: 'nav-cloud' },
      'aria-label': '云端同步状态',
      title: '云端同步：点一下去设置里查看',
      onClick: () => {
        location.hash = 'settings'
      }
    },
    [icon('cloud', { size: 16, className: 'nav-cloud__icon' }), text]
  )

  let currentUser = null
  const paint = () => {
    const status = cloudStatus()
    node.dataset.state = stateOf(status, currentUser)
    text.textContent = describe(status, currentUser)
  }

  onCloudStatus(paint)
  watchSession((user) => {
    currentUser = user
    paint()
  })
  paint()

  sidenav.append(node)
  return node
}
