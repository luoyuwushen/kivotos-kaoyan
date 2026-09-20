/**
 * 站点页脚与用途声明。
 * 用户明确本站为**个人非商业**用途，这里把这一点写死在界面上。
 */

import { el } from '../lib/utils.js'
import { brandMark } from './icons.js'

export const NONCOMMERCIAL_NOTICE = '本站为个人备考自用的非商业网站，无广告、无收费、无任何形式的盈利。'

export const CHARACTER_NOTICE =
  '《蔚蓝档案》及其角色（小鸟游星野、阿洛娜、普拉娜）版权归 Nexon / Yostar 所有。本站为非官方粉丝作品，站内 Q 版形象为自绘原创，不使用官方立绘与游戏素材。'

/**
 * 页面页脚。
 * 侧栏只负责导航——版权声明这类长文本压在这里，
 * 压在背景层那条发光云带上，页面才「落地」。
 */
export function appFooter() {
  const siteName = '基沃托斯作战本部'
  const footer = el('footer', { class: 'pagefoot' }, [
    el('div', { class: 'pagefoot__inner' }, [
      el('div', { class: 'pagefoot__brand' }, [brandMark(22), el('span', {}, siteName)]),
      el('div', { class: 'pagefoot__note' }, [
        el('div', {}, NONCOMMERCIAL_NOTICE),
        el('div', { style: { marginTop: '0.35rem' } }, CHARACTER_NOTICE)
      ]),
      el(
        'div',
        { class: 'pagefoot__meta' },
        `数据保存在你自己的浏览器里 · ${new Date().getFullYear()}`
      )
    ])
  ])
  return footer
}
