/**
 * 站点页脚与用途声明。
 * 用户明确本站为**个人非商业**用途，这里把这一点写死在界面上。
 */

import { el } from '../lib/utils.js'

export const NONCOMMERCIAL_NOTICE = '本站为个人备考自用的非商业网站，无广告、无收费、无任何形式的盈利。'

export const CHARACTER_NOTICE =
  '《蔚蓝档案》及其角色（小鸟游星野、阿洛娜、普拉娜）版权归 Nexon / Yostar 所有。本站为非官方粉丝作品，站内 Q 版形象为自绘原创，不使用官方立绘与游戏素材。'

export function footer() {
  return el('footer', { class: 'sidenav__foot' }, [
    el('div', {}, NONCOMMERCIAL_NOTICE),
    el('div', { style: { marginTop: '0.5rem' } }, CHARACTER_NOTICE),
    el(
      'div',
      { style: { marginTop: '0.5rem' } },
      `数据保存在你自己的浏览器里 · ${new Date().getFullYear()}`
    )
  ])
}

/** 手机端页脚（侧栏在手机上变成标签栏，放不下声明，所以单独放在内容末尾） */
export function footerBlock() {
  return el(
    'div',
    {
      class: 'card card--flat',
      style: { fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: '1.7' }
    },
    [el('div', {}, NONCOMMERCIAL_NOTICE), el('div', { style: { marginTop: '0.4rem' } }, CHARACTER_NOTICE)]
  )
}
