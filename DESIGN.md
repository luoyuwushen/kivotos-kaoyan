# DESIGN.md

> 把考研这件苦差事，做成基沃托斯的一份日常委托单。

## 1. Visual Theme & Atmosphere

**Style**: Blue Archive / 基沃托斯学园终端（Kivotos School Terminal）
**Keywords**: 澄澈、明亮、圆润、光环、委托单、学园事务局、轻快
**Tone**: 干净通透的官方学园 App —— NOT 暗黑、NOT 压抑、NOT 电竞霓虹、NOT 通用 SaaS 卡片堆
**Feel**: 像刚打开什亭之箱时那一片发光的蓝，白底上浮着一枚缓慢转动的光环。

**Interaction Tier**: L2 流畅交互
**Dependencies**: CSS only（IntersectionObserver + Web Animations API，零第三方运行时依赖）

**设计依据**：
- 参考站 [`shittim-team/homepage`](https://github.com/shittim-team/homepage) 与 [`小鱼档案`](https://github.com/ialley-workshop-open-collection/homepage-weilandangan) 的 BA 复刻路线（加载界面 / 光环 / 弹窗 / 点击特效）。
- 本项目的**独有母题**：把「每日学习任务」当作基沃托斯发放的**委托单（Task / 依赖）**，把「考研」当作一场长期作战。所有进度条、勾选框、徽章都从"学园事务局"这套世界观里长出来，而不是套通用待办清单。

---

## 2. Color Palette & Roles

```css
:root {
  /* Backgrounds */
  --bg: #F2F7FC;                    /* 页面背景：极浅的蓝白 */
  --surface: #FFFFFF;               /* 卡片 / 容器 */
  --surface-alt: #E9F2FB;           /* 次级表面 / 交替区块 */
  --surface-hover: #F5FAFF;         /* 悬停态表面 */

  /* Borders */
  --border: #C9DDF0;                /* 默认边框：带蓝调的浅灰 */
  --border-strong: #9FC4E4;         /* 强调边框 */
  --border-hover: #5AB0EE;          /* 悬停边框 */

  /* Text */
  --text: #123A5C;                  /* 标题、重要数字：深藏青，替代纯黑 */
  --text-secondary: #44688A;        /* 正文、描述 */
  --text-tertiary: #8AA6BF;         /* 标签、辅助信息 */

  /* Accent */
  --accent: #3D9BE9;                /* 主强调色：BA 蓝，用于 CTA / 活跃态 / 光环 */
  --accent-deep: #1E6FB8;           /* 强调色的深位：hover 文字、边界 */
  --accent-soft: #CBE6FB;           /* 强调色的浅位：选中底、进度槽 */
  --accent-hover: #2E8BD9;

  /* 角色色（每个角色只用于自己的形象与自己的台词气泡） */
  --hoshino: #F2A0BF;               /* 小鸟游星野：粉 */
  --hoshino-deep: #D9739A;
  --arona: #5BC8F5;                 /* 阿洛娜：天蓝 */
  --plana: #A9B4D8;                 /* 普拉娜：灰蓝紫 */

  /* Semantic */
  --success: #35B37E;
  --warning: #EFA82B;
  --error: #E2607A;
  --star: #FFC93C;                  /* 三星评价 / 勋章金 */

  /* RGB variants for rgba() */
  --bg-rgb: 242, 247, 252;
  --surface-rgb: 255, 255, 255;
  --accent-rgb: 61, 155, 233;
  --text-rgb: 18, 58, 92;
  --hoshino-rgb: 242, 160, 191;

  /* 玻璃质感（BA 大量使用半透明白底） */
  --glass: rgba(255, 255, 255, 0.72);
  --glass-border: rgba(255, 255, 255, 0.85);
}
```

**Color Rules:**
- 所有颜色一律通过 CSS 变量引用，组件中**零硬编码 hex**。
- 同一个区块内只允许一个强调色；角色色只在角色自己的形象、台词气泡、对应勋章上出现。
- 深色文字用 `--text`（深藏青）而不是纯黑，保持 BA 的通透感。
- 语义色只表达状态，不用于装饰。

---

## 3. Typography Rules

**Font Stack:**
```css
@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap');
```
> 中文圆体走本地优先栈（`PingFang SC` / `HarmonyOS Sans SC` / `MiSans` / `Microsoft YaHei UI`），
> 并留一个可选自托管分支：`assets/fonts/` 放入 [霞鹜文楷](https://github.com/CMBill/lxgw-wenkai-web)（OFL 授权）后启用 `@font-face`，用于「星野台词」的手写感。

```css
:root {
  --font-display: 'Baloo 2', 'M PLUS Rounded 1c', 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei UI', sans-serif;
  --font-body: 'M PLUS Rounded 1c', 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei UI', sans-serif;
  --font-num: 'Baloo 2', 'M PLUS Rounded 1c', system-ui, sans-serif;   /* 倒计时数字专用 */
*
```

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| 倒计时主数字 | `--font-num` | `clamp(4.5rem, 16vw, 11rem)` | 800 | 0.86 | `-0.03em` |
| Hero H1（页面主标题） | `--font-display` | `clamp(1.6rem, 3.2vw, 2.15rem)` | 700 | 1.25 | `0.01em` |
| Section H2 | `--font-display` | `clamp(1.15rem, 2vw, 1.4rem)` | 700 | 1.35 | `0.01em` |
| H3 / 卡片标题 | `--font-body` | `1.0625rem` | 700 | 1.45 | `0.01em` |
| Body | `--font-body` | `0.9375rem` | 400–500 | 1.75 | `0.02em` |
| Label / 标签 | `--font-body` | `0.8125rem` | 600 | 1.5 | `0.04em` |
| Mono / 代码 / 时间戳 | `ui-monospace, 'SF Mono', Consolas, monospace` | `0.8125rem` | 500 | 1.6 | `0` |

**Typography Rules:**
- 中文正文行高 ≥ 1.75，字距 `0.02em`；正文 ≥ 15px。
- 标题一律圆体 700/800，靠**字号与颜色**建立层次，不靠全大写、不靠字间距拉开的小标签。
- 数字（倒计时、天数、百分比）统一 `font-variant-numeric: tabular-nums`，避免跳动。
- **NEVER use**: 纯黑 `#000`、细衬线做中文标题、全大写英文标签、每段标题上方加小字眉标。

**Text Decoration:**
- 倒计时数字：**无渐变**，纯 `--text` 深藏青 + 身后独立光环图形（装饰交给图形，不交给文字）。
- Hero H1：无投影。层次由字号 + `--text` / `--text-secondary` 双色建立。
- 唯一允许的渐变：`--accent → --arona` 用于**进度条填充**（信息性，非装饰）。

---

## 4. Component Stylings

### Buttons
```css
.btn {
  --btn-bg: var(--surface);
  --btn-fg: var(--text);
  --btn-bd: var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 44px;
  padding: 0 1.25rem;
  border: 1.5px solid var(--btn-bd);
  border-radius: 999px;
  background: var(--btn-bg);
  color: var(--btn-fg);
  font-family: var(--font-body);
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
              background-color 0.18s ease, border-color 0.18s ease,
              box-shadow 0.18s ease, color 0.18s ease;
}
.btn:hover { transform: translateY(-2px); border-color: var(--border-hover); background: var(--surface-hover); }
.btn:active { transform: translateY(0) scale(0.97); }
.btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

.btn--primary { --btn-bg: var(--accent); --btn-fg: #fff; --btn-bd: var(--accent); box-shadow: 0 4px 0 var(--accent-deep); }
.btn--primary:hover { --btn-bg: var(--accent-hover); --btn-bd: var(--accent-hover); background: var(--accent-hover); border-color: var(--accent-hover); }
.btn--primary:active { box-shadow: 0 1px 0 var(--accent-deep); transform: translateY(3px); }

.btn--ghost { --btn-bg: transparent; --btn-bd: transparent; color: var(--text-secondary); }
.btn--ghost:hover { background: var(--accent-soft); color: var(--accent-deep); }

.btn--icon { width: 44px; padding: 0; border-radius: 50%; }
```

### Cards
```css
.card {
  position: relative;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 18px;
  padding: 1.125rem 1.25rem;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.card:hover { border-color: var(--border-hover); box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.12); }
.card:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.card--flat { border-radius: 14px; box-shadow: none; }

/* SpotlightCard：鼠标跟踪聚光，成本极低 */
.card--spot::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(320px circle at var(--mx, 50%) var(--my, 0%),
              rgba(var(--accent-rgb), 0.14), transparent 65%);
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}
.card--spot:hover::before { opacity: 1; }
```

### Navigation
```css
/* 桌面：左侧竖排导航；移动：底部标签栏 */
.nav-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-height: 44px;
  padding: 0.5rem 0.875rem;
  border-radius: 12px;
  color: var(--text-secondary);
  font-weight: 700;
  font-size: 0.9375rem;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease;
}
.nav-item:hover { background: var(--surface-alt); color: var(--accent-deep); }
.nav-item:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.nav-item[aria-current='page'] { background: var(--accent-soft); color: var(--accent-deep); }  /* 活跃态 */
```

### Links
```css
a { color: var(--accent-deep); text-decoration-color: var(--accent-soft); text-underline-offset: 3px; }
a:hover { text-decoration-color: var(--accent); }
a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
```

### Tags / Badges
```css
.tag {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-size: 0.8125rem; font-weight: 700;
}
.tag--math { background: rgba(var(--accent-rgb), 0.16); color: var(--accent-deep); }
.tag--done { background: rgba(53, 179, 126, 0.16); color: var(--success); }
.tag--overdue { background: rgba(226, 96, 122, 0.16); color: var(--error); }
```

### 光环（项目签名图形）
```css
/* 倒计时身后缓慢转动的光环 —— 全站唯一的常驻装饰 */
.halo {
  position: absolute;
  border-radius: 50%;
  border: 3px solid rgba(var(--accent-rgb), 0.55);
  box-shadow: 0 0 24px rgba(var(--accent-rgb), 0.35), inset 0 0 18px rgba(var(--accent-rgb), 0.25);
  animation: halo-turn 18s linear infinite;
  pointer-events: none;
}
.halo::after {           /* 环上的缺口，让它不像普通圆圈 */
  content: '';
  position: absolute; inset: -5px;
  border-radius: 50%;
  border: 3px solid transparent;
  border-top-color: var(--bg);
  border-right-color: var(--bg);
  transform: rotate(20deg);
}
@keyframes halo-turn { to { transform: rotate(360deg); } }
```

### 委托单条目（每日任务）
```css
.quest {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: 14px;
  border: 1.5px solid transparent;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}
.quest:hover { background: var(--surface-alt); border-color: var(--border); }
.quest[data-done='true'] .quest__title { color: var(--text-tertiary); text-decoration: line-through; }
.quest__check {
  appearance: none;
  width: 26px; height: 26px;
  border: 2px solid var(--border-strong);
  border-radius: 9px;              /* BA 的圆角勾选框 */
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}
.quest__check:hover { border-color: var(--accent); }
.quest__check:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.quest__check:checked {
  background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / 17px no-repeat;
  border-color: var(--accent);
  animation: check-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes check-pop { 0% { transform: scale(0.8); } 60% { transform: scale(1.12); } 100% { transform: scale(1); } }
```

### 台词气泡（星野 / 阿洛娜 / 普拉娜）
```css
.speech {
  position: relative;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 18px 18px 18px 6px;
  padding: 0.875rem 1.125rem;
  font-size: 1rem;
  line-height: 1.75;
  color: var(--text);
  box-shadow: 0 6px 18px rgba(var(--text-rgb), 0.07);
}
.speech--hoshino { border-color: rgba(var(--hoshino-rgb), 0.5); }
.speech__who { display: block; font-size: 0.8125rem; font-weight: 800; color: var(--hoshino-deep); letter-spacing: 0.04em; }
```

---

## 5. Layout Principles

**Container:**
- Max width: `1180px`
- Padding: `clamp(1rem, 4vw, 2rem)`
- Narrow variant (长文本 / 计划说明): `720px`

**Spacing Scale:**
- Section padding: `clamp(1.5rem, 4vw, 2.5rem)`
- Component gap: `1rem`（卡内）/ `1.5rem`（卡间）
- Card internal padding: `1.125rem 1.25rem`

**Grid:**
```css
.shell {                      /* 桌面：侧栏 + 内容 */
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: clamp(1rem, 3vw, 2rem);
  max-width: 1180px;
  margin-inline: auto;
  padding: clamp(1rem, 4vw, 2rem);
}
.grid-auto {                  /* Bento 用的不等大栅格基座 */
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
}
.bento { grid-template-columns: repeat(6, 1fr); }
.bento > .span-3 { grid-column: span 3; }
.bento > .span-2 { grid-column: span 2; }
@media (max-width: 900px) { .bento > * { grid-column: span 6 !important; } }
```

**对齐**：全部**左对齐**。只有倒计时数字与角色台词允许居中——它们是"仪式感"区块，其余一律左对齐以保持仪表盘的可扫读性。

---

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | 无阴影，仅 1.5px 边框 | 列表条目、次级卡片 |
| Subtle | `0 2px 8px rgba(var(--text-rgb), 0.05)` | 普通卡片 |
| Elevated | `0 8px 24px rgba(var(--accent-rgb), 0.12)` | 悬停卡片、弹窗 |
| Pressed | `0 4px 0 var(--accent-deep)`（实心投影，非模糊） | 主按钮 |

**规则**：阴影永远带蓝调（用 accent-rgb / text-rgb），**禁止使用中性灰 `rgba(0,0,0,.1)`**——那是通用 SaaS 卡片的特征。弹窗用 `backdrop-filter: blur(10px)`（≤ 14px）。

---

## 7. Animation & Interaction

**Motion Philosophy**: 动效只在"回应你的操作"和"一次负载入场"两处出现；其余一律静止。
**Tier**: L2

### Dependencies
无第三方库。使用 IntersectionObserver（滚动 reveal）+ Web Animations API（一次性入场编排）。

### Entrance Animation
```css
/* 唯一一次编排式入场：整页错峰浮现，1.1s 内结束，结束后不再打扰 */
@keyframes rise-in {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: none; }
}
.rise { animation: rise-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
.rise[data-delay='1'] { animation-delay: 0.07s; }
.rise[data-delay='2'] { animation-delay: 0.14s; }
.rise[data-delay='3'] { animation-delay: 0.21s; }
.rise[data-delay='4'] { animation-delay: 0.28s; }

/* 光环：全站唯一常驻动画 */
@keyframes halo-turn { to { transform: rotate(360deg); } }
@keyframes halo-pulse { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
```

### Scroll Behavior
```js
// 滚动 reveal：只做一次，进入视口后立即 unobserve
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('rise');
    io.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
```
> 本站在**视图切换**时复用同一套 reveal（切页 → 新视图元素重新 observe），不做视差。理由：这是每天要打开的学习工具，滚动视差会拖慢信息读取。

### Hover & Focus States
- 所有可交互元素：`hover` 有可见变化 + `:focus-visible` 有 3px 强调色描边（见第 4 节）。
- 卡片 hover：边框转 `--border-hover` + 蓝调阴影 + 可选 SpotlightCard 聚光。
- 键盘可达：全部操作可用 Tab 到达，焦点顺序跟随视觉顺序。

### Signature Moments（6 类，全部落地）
| 类别 | 落点 |
|------|------|
| Text — Hero | 倒计时数字：数字滚动（`tabular-nums` + 逐位翻动） |
| Text — Section H2 | 各区块标题：滚动 reveal 浮现 |
| Text — Body/Label | 星野台词：逐字打字机（仅一次，可点击跳过） |
| Element | 勾选每日委托：`check-pop` 弹跳 + 进度环推进 |
| Component | Bento 不等大栅格 + SpotlightCard 聚光（不用等大 grid） |
| Background | 光环图形 + 缓慢漂浮的光点（`translate3d`，非 blur，零 GPU 压力） |

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .halo { animation: none; }
  .rise { opacity: 1; transform: none; }
}
```
```js
// 打字机 / 数字滚动在减弱动效时直接给终值
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

---

## 8. Do's and Don'ts

### Do
- 把每个功能都接到"基沃托斯学园事务局"这套世界观上：委托单、勋章、战力、据点。
- 用 `--accent-soft` 做选中态与进度槽，用 `--accent` 只做真正的主行动点。
- 倒计时是全站唯一的"巨型元素"，其余区块保持克制，把胆量花在这一处。
- 每个数字都 `tabular-nums`；每处空状态都给一句**可执行的下一步**（不是"暂无数据"）。
- 中文正文行高 ≥ 1.75、字距 `0.02em`、字号 ≥ 15px。
- 移动端把导航折成底部标签栏，触摸目标 ≥ 44×44px。
- 角色色只用在角色自己的形象、台词和对应勋章上。

### Don't
- ❌ 不用纯黑 `#000` 文字；不用中性灰阴影 `rgba(0,0,0,.1)`。
- ❌ 不用暗色电竞底 + 霓虹发光（那不是 BA，是赛博朋克）。
- ❌ 不做等大卡片网格堆满一屏；列表区用 Bento 不等大布局。
- ❌ 不在每个标题上方加全大写小字眉标；不用 `A · B · C` 式元信息串。
- ❌ 不给每个区块都加 fade-and-slide-up 的悬停动画；动效只回应操作。
- ❌ 不用 `filter: blur()` 做移动元素的景深；用 opacity + scale。
- ❌ 不覆盖大面积滚动区做 `backdrop-filter`；值不超过 14px。
- ❌ 不给按钮文字加 `→`；不用 Emoji 当功能图标（这是学园终端，不是聊天软件）。
- ❌ 不硬编码颜色；不从外部站点热链角色立绘。
- ❌ 不把角色说话写成"系统提示"口吻；星野是前辈，不是客服。

---

## 9. Responsive Behavior

**Breakpoints:**
| Name | Width | Key Changes |
|------|-------|-------------|
| Desktop | > 1000px | 左侧固定侧栏 232px + 内容区；Bento 六列栅格 |
| Tablet | 641–1000px | 侧栏折叠为顶部横行；Bento 降为两列；倒计时数字 `clamp` 收窄 |
| Mobile | ≤ 640px | 底部标签栏（安全区适配）；单列堆叠；卡片内边距 1rem；弹窗改全屏抽屉 |

**Touch Targets:** 最小 44×44px；列表条目行高 ≥ 52px
**Collapsing Strategy:** 导航 → 底部标签栏；Bento → 单列；表格 → 卡片化；长文本 → 折叠 + "展开"

```css
@media (max-width: 1000px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .sidenav { position: static; }
}
@media (max-width: 640px) {
  .shell { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
  .tabbar {
    position: fixed; inset: auto 0 0 0;
    display: flex;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--glass);
    backdrop-filter: blur(10px);
    border-top: 1.5px solid var(--border);
  }
  .tabbar .nav-item { flex: 1; flex-direction: column; gap: 0.15rem; font-size: 0.6875rem; min-height: 56px; }
  .countdown__num { font-size: clamp(3.75rem, 20vw, 5.5rem); }
}
/* 防止任何横向溢出 */
html, body { max-width: 100%; overflow-x: clip; }
img, svg, canvas { max-width: 100%; height: auto; }
```

---

## 附：角色形象使用说明（版权护栏）

- 站内角色形象为**本项目自绘的内联 SVG 原创 Q 版造型**，只借用角色的**配色、光环、星形发饰**等通用视觉特征，**不复制任何官方立绘、同人图或游戏内素材**。
- 用户可自行替换为自有图片：把文件放入 `public/characters/`，按 `README.md` 的说明替换即可（无需改代码）。
- 站点永久**非商业、无广告、不收费**，页脚保留角色版权归属声明与"非官方"声明。
- 不热链任何第三方图片；不使用官方 Logo 与游戏内 UI 素材。
