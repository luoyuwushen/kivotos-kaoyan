/**
 * 站点页脚与用途声明。
 *
 * 用途：用户明确本站为**个人非商业**用途，这里把这一点写死在界面上。
 *
 * 素材口径（2026 起变更）：
 * 早先的说法是「不使用官方立绘与游戏内素材」。登录场景移植之后这个说法不再成立 ——
 * 站内确实使用了《蔚蓝档案》的官方素材（登录场景的 Spine 骨骼与贴图）与同人形象。
 * 现在的口径是：**非商业使用 + 明确署名 + 权利人可随时要求下架**，
 * 并留一个可联系的邮箱。这样既如实描述，也给了权利人一个明确的处理入口。
 */

import { el } from '../lib/utils.js'
import { brandMark } from './icons.js'

export const NONCOMMERCIAL_NOTICE = '本站为个人备考自用的非商业网站，无广告、无收费、无任何形式的盈利。'

/** 权利人要求下架时的联系方式（页面上要看得见，不能只写在代码注释里） */
export const CONTACT_EMAIL = '2651038380@qq.com'

export const CHARACTER_NOTICE =
  '《蔚蓝档案》及其角色（小鸟游星野、阿洛娜、普拉娜）版权归 Nexon / Yostar 所有。' +
  '本站为非官方粉丝作品，登录场景使用了官方 / 同人的角色与场景素材，仅作个人非商业用途；' +
  `如有侵权，请联系 ${CONTACT_EMAIL}，我们会立即移除。`

/** Spine 运行时要求随再分发附带版权声明（Spine Runtimes License Agreement） */
export const SPINE_NOTICE =
  '登录场景由 Spine 运行时实时渲染，Spine Runtimes © Esoteric Software LLC，依 Spine Runtimes License Agreement 使用。'

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
        el('div', { style: { marginTop: '0.35rem' } }, CHARACTER_NOTICE),
        el('div', { style: { marginTop: '0.35rem' } }, SPINE_NOTICE)
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
