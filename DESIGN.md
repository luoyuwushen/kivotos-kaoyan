# DESIGN.md

> 把考研这件苦差事，做成基沃托斯的一份日常委托单。
> 视觉基准不是"浅蓝色 SaaS 面板"，而是**官方站那片天空**：饱和的晴空蓝、压得住的白、以及一层会呼吸的光。

## 1. Visual Theme & Atmosphere

**Style**: Blue Archive / 基沃托斯学园终端（Kivotos School Terminal）
**Keywords**: 晴空、通透、圆润、光环、委托单、学园事务局、晨光
**Tone**: 像**早上七点推开窗**看到的那片天 —— NOT 暗黑、NOT 压抑、NOT 电竞霓虹、NOT 通用 SaaS 卡片堆
**Feel**: 白底上浮着一层薄的天空渐变，一格一格的光从左上角斜射下来，倒计时数字后面有一枚缓慢转动的光环，页脚压着一条发光的云带。

**Interaction Tier**: L2 流畅交互
**Dependencies**: CSS only（IntersectionObserver + Web Animations API），零第三方运行时依赖。

### 设计依据（本版重做的原因）

上一版的问题不是"不够 BA"，是**太淡、太平、太均匀**：所有卡片同一个白底、同一个圆角、同一种边框，整页读起来像一张 Excel；蓝色 `#3D9BE9` 在浅底上饱和度不足，撑不起主角；侧栏塞了 5 行版权小字，把导航挤成了配角。

本版依据**官方站实测 Token**（用 Playwright 打开官方站抓 `getComputedStyle`，脚本见 `scripts/ba-recon.mjs`，产物 `ba-recon/tokens.json` + 截图）：

| 来源 | 实测值 | 本版如何用 |
|------|--------|-----------|
| 蔚蓝档案中文官网 `bluearchive-cn.com` | 主色 **`#1189F9`**（`fill` 第 2 位，`color` 第 5 位） | 收为本版 `--accent`，替换偏灰的 `#3D9BE9` |
| 同上 | 面板 = 白底 + **2px `#1189F9` 实边框**（`border` 计数：`2px #1189f9` ×6） | 卡片边框 1.5px → **2px**，并且边框带蓝调而非灰调 |
| 同上 | 圆角三档：**7.5px / 11.25px / 37.5px**，其余 0px | 收敛圆角：控件小圆角、面板中圆角、交互件胶囊 |
| 同上 | 阴影 **`rgba(78,78,78,.54) 0 0 7.5px`** —— 贴身、几乎无位移 | 阴影改为**小半径、低位移、贴边**，不再是弥散大投影 |
| 日服官网 `bluearchive.jp` | 晴空：饱和天蓝 → 白色积云 → 白色光晕；画面上叠**细密网格纹理**；导航= 深色半透条 + **青色 (#4DD0E1 系) 高亮下划线** | 全站背景层 + 顶栏导航态 |
| 中文官网 | 标题下方**斜杠虚线饰带**（`////` 一排小斜杠） | 收为本站区块分隔符 `.strap` |
| 两站共有 | 深海军蓝文字（`#14273B` / `#001747`）代替纯黑 | 沿用 `--text` 深藏青 |

**本项目的独有母题**：把「每日学习任务」当作基沃托斯发放的**委托单**，把「考研」当作一场长期作战。所有进度条、勾选框、徽章都从"学园事务局"这套世界观里长出来，而不是套通用待办清单。

---

## 2. Color Palette & Roles

```css
:root {
  /* ---- 天空分层：页面背景不是一块平色，是一天的天色 ---- */
  --sky-1: #7CC2F2;                 /* 天顶：饱和晴空蓝（对应官方站 #1189F9 的浅位） */
  --sky-2: #A9DBF8;
  --sky-3: #D6EDFC;
  --sky-4: #EEF7FE;                 /* 地平线：近白 */
  --bg: #F4F9FE;                    /* 落地底色：卡片外的"空气" */
  --cloud: rgba(255, 255, 255, 0.9);/* 云带：页脚那条发光白雾 */

  /* ---- 表面 ---- */
  --surface: #FFFFFF;               /* 主面板 */
  --surface-alt: #E4F1FC;           /* 次级表面 / 交替区块 */
  --surface-hover: #F7FBFF;
  --surface-sunken: #DCEBF9;        /* 凹槽：进度条底、统计块 */

  /* ---- 半透明面板（浮在天空上的那层） ---- */
  --panel-glass: rgba(255, 255, 255, 0.82);
  --panel-solid: #FFFFFF;

  /* ---- 边框：一律带蓝调，且比上一版更实 ---- */
  --border: #AFD3EF;
  --border-strong: #7FB8E4;
  --border-hover: #1189F9;

  /* ---- 文字 ---- */
  --text: #123A5C;                  /* 标题、数字：深藏青，替代纯黑 */
  --text-secondary: #3F6B90;
  --text-tertiary: #7C9CBB;

  /* ---- 强调色：官方站 #1189F9 起手 ---- */
  --accent: #1189F9;
  --accent-deep: #0A63BE;           /* hover 文字 / 实心投影底 */
  --accent-soft: #D3E9FE;           /* 选中底、进度槽 */
  --accent-hover: #0B79E4;
  --accent-sky: #6EC6FF;            /* 强调色的亮位：渐变上端、光标 */
  --accent-ink: #0A3D6B;            /* 天上那种压得住的深蓝，用于实心面板 */

  /* ---- 角色色（只用于角色自己的形象、台词气泡、对应勋章） ---- */
  --hoshino: #F2A0BF;               /* 小鸟游星野：粉 */
  --hoshino-deep: #D9739A;
  --arona: #5BC8F5;                 /* 阿洛娜：天蓝 */
  --plana: #A9B4D8;                 /* 普拉娜：灰蓝紫 */

  /* ---- 语义 ---- */
  --success: #14A06B;
  --warning: #D18A0C;
  --error: #DC4C6A;
  --star: #FFC93C;                  /* 三星评价 / 勋章金 */

  /* ---- RGB 辅助值（构造 rgba 用，避免再写 hex） ---- */
  --bg-rgb: 244, 249, 254;
  --surface-rgb: 255, 255, 255;
  --accent-rgb: 17, 137, 249;
  --accent-ink-rgb: 10, 61, 107;
  --text-rgb: 18, 58, 92;
  --hoshino-rgb: 242, 160, 191;

  /* ---- 玻璃（值不超过 14px） ---- */
  --glass: rgba(255, 255, 255, 0.78);
  --glass-border: rgba(255, 255, 255, 0.9);
}
```

**Color Rules:**
- 所有颜色一律通过 CSS 变量引用，组件中**零硬编码 hex**（`rgba()` 只允许包 `rgb` 变量）。
- 同一个区块内只允许一个强调色；角色色只在角色自己的形象、台词气泡、对应勋章上出现。
- 深色文字用 `--text`（深藏青）而不是纯黑，保持 BA 的通透感。
- 语义色只表达状态，不用于装饰。
- **天空层只用 `--sky-*`，卡片只用 `--surface*`，两者不串味**：天空永远在内容之下，面板永远在天空之上。

---

## 3. Typography Rules

**Font Stack:**
```css
@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap');
```
> 中文圆体走本地优先栈（`PingFang SC` / `HarmonyOS Sans SC` / `MiSans` / `Microsoft YaHei UI`），
> 断网也完整可用。可选自托管分支：`assets/fonts/` 放入 [霞鹜文楷](https://github.com/CMBill/lxgw-wenkai-web)（OFL 授权）后启用 `@font-face`，用于「星野台词」的手写感。

```css
:root {
  --font-display: 'Baloo 2', 'M PLUS Rounded 1c', 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei UI', sans-serif;
  --font-body: 'M PLUS Rounded 1c', 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei UI', sans-serif;
  --font-num: 'Baloo 2', 'M PLUS Rounded 1c', system-ui, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Consolas, monospace;
}
```

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| 倒计时主数字 | `--font-num` | `clamp(5rem, 17vw, 12rem)` | 800 | 0.84 | `-0.035em` |
| Hero H1（页面主标题） | `--font-display` | `clamp(1.75rem, 3.4vw, 2.5rem)` | 800 | 1.22 | `0.005em` |
| Section H2 | `--font-display` | `clamp(1.25rem, 2.1vw, 1.55rem)` | 800 | 1.32 | `0.01em` |
| H3 / 卡片标题 | `--font-body` | `1.0625rem` | 700 | 1.45 | `0.01em` |
| Body | `--font-body` | `0.9375rem` | 400–500 | 1.75 | `0.02em` |
| Label / 标签 | `--font-body` | `0.8125rem` | 700 | 1.5 | `0.03em` |
| 数字次级（进度、统计） | `--font-num` | `1.5rem–2rem` | 800 | 1.1 | `-0.01em` |
| Mono / 代码 / 时间戳 | `--font-mono` | `0.8125rem` | 500 | 1.6 | `0` |

**Typography Rules:**
- 中文正文行高 ≥ 1.75，字距 `0.02em`；正文 ≥ 15px。
- 标题一律圆体 700/800，靠**字号与颜色**建立层次，不靠全大写、不靠字间距拉开的小标签。
- **只保留两级数字**：Hero 的巨型倒计时，与卡片里的 `1.5–2rem` 统计数字。中间不再插第三级，避免"到处都在喊"。
- 数字统一 `font-variant-numeric: tabular-nums`，避免跳动。
- **NEVER use**: 纯黑 `#000`、细衬线做中文标题、全大写英文标签、每段标题上方加小字眉标。

**Text Decoration:**
- 倒计时数字：`--text` 深藏青改到**天空面板上用纯白**，身后独立光环图形 + 极轻的白色柔光（`text-shadow` 用于**暗底大字**这一种情况，符合决策表 B 档）。
- Hero H1：无投影，无渐变。层次由字号 + 颜色建立。
- 全站**唯一**允许的文字渐变：无。渐变只用于**图形**（进度条填充、光环、天空）。
- 区块分隔用 `.strap`（斜杠饰带图形），不用文字下划线。

---

## 4. Component Stylings

### 4.1 天空面板（本站的主角容器）

```css
/* 首页 Hero：一块真的"天窗"。整页唯一的大面积饱和色 */
.sky-panel {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: var(--r-xl);
  border: 2px solid var(--border-strong);
  padding: clamp(1.5rem, 4vw, 2.5rem);
  color: #fff;                                  /* 面板内文字一律纯白 */
  background:
    /* ① 左上角的天光 */
    radial-gradient(120% 90% at 12% 0%, rgba(var(--surface-rgb), 0.55), transparent 58%),
    /* ② 主天空渐变 */
    linear-gradient(168deg, var(--sky-1) 0%, var(--accent) 42%, var(--accent-sky) 100%);
  box-shadow: 0 18px 40px -18px rgba(var(--accent-rgb), 0.5);
}

/* 云带：底部一条发光白雾，官方站那张图的招牌 */
.sky-panel::after {
  content: '';
  position: absolute;
  inset: auto -10% -34% -10%;
  height: 62%;
  border-radius: 50% 50% 0 0 / 55% 55% 0 0;
  background: radial-gradient(60% 100% at 22% 100%, rgba(var(--surface-rgb), 0.95), transparent 70%),
              radial-gradient(50% 100% at 62% 100%, rgba(var(--surface-rgb), 0.7), transparent 72%);
  pointer-events: none;
}
```

### 4.2 卡片

```css
.card {
  position: relative;
  background: var(--surface);
  border: 2px solid var(--border);          /* 官方站口径：2px 蓝调实边框 */
  border-radius: var(--r-lg);
  padding: var(--pad-card);
  box-shadow: var(--sh-subtle);
  transition: transform 0.2s var(--ease-out), border-color 0.2s ease, box-shadow 0.2s ease;
}
.card:hover { border-color: var(--border-hover); box-shadow: var(--sh-elevated); }
.card:focus-within { border-color: var(--accent); }
.card--flat { border-radius: var(--r-md); box-shadow: none; }

/* 卡头左侧的短竖条：给每种卡片一个"身份色"，打破全白均质 */
.card__head::before {
  content: '';
  width: 4px;
  align-self: stretch;
  min-height: 22px;
  border-radius: 999px;
  background: var(--card-tone, var(--accent));
}

/* SpotlightCard：鼠标跟踪聚光，成本极低（单次 repaint） */
.card--spot::before {
  content: '';
  position: absolute; inset: 0;
  border-radius: inherit;
  background: radial-gradient(320px circle at var(--mx, 50%) var(--my, 0%),
              rgba(var(--accent-rgb), 0.16), transparent 66%);
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}
.card--spot:hover::before { opacity: 1; }
```

### 4.3 Buttons

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  min-height: 44px; padding: 0 1.25rem;
  border: 2px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-body); font-size: 0.9375rem; font-weight: 700;
  letter-spacing: 0.02em; cursor: pointer;
  transition: transform 0.18s var(--ease-pop), background-color 0.18s ease,
              border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
}
.btn:hover  { transform: translateY(-2px); border-color: var(--border-hover); background: var(--surface-hover); }
.btn:active { transform: translateY(0) scale(0.97); }
.btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

/* 主按钮：实心蓝 + 硬投影（BA 的"按下去"感，不是弥散阴影） */
.btn--primary {
  background: var(--accent); border-color: var(--accent); color: #fff;
  box-shadow: 0 4px 0 var(--accent-deep);
}
.btn--primary:hover  { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn--primary:active { box-shadow: 0 1px 0 var(--accent-deep); transform: translateY(3px); }

.btn--ghost { border-color: transparent; background: transparent; color: var(--text-secondary); }
.btn--ghost:hover { background: var(--accent-soft); border-color: transparent; color: var(--accent-deep); }

/* 浮在天空面板上的按钮 */
.btn--on-sky {
  background: rgba(var(--surface-rgb), 0.92); border-color: transparent; color: var(--accent-deep);
  box-shadow: 0 4px 0 rgba(var(--accent-ink-rgb), 0.35);
}
.btn--on-sky:hover { background: var(--surface); color: var(--accent-deep); }

.btn--icon { width: 44px; padding: 0; border-radius: 50%; }
```

### 4.4 Navigation

```css
/* 桌面：左侧竖排；平板：顶部两行；移动：底部标签栏 */
.nav-item {
  display: flex; align-items: center; gap: 0.625rem;
  min-height: 44px; padding: 0.5rem 0.875rem;
  border: none; border-radius: var(--r-sm);
  background: transparent; color: var(--text-secondary);
  font-weight: 700; font-size: 0.9375rem; text-align: left;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease;
}
.nav-item:hover { background: var(--surface-alt); color: var(--accent-deep); }
.nav-item:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

/* 活跃态：不是"涂一块浅蓝"，而是实心蓝 + 左侧光环点 —— 官方站导航那种明确的当前位置 */
.nav-item[aria-current='page'] {
  background: var(--accent); color: #fff; font-weight: 800;
  box-shadow: 0 3px 0 var(--accent-deep);
}
.nav-item[aria-current='page'] .nav-item__icon { color: #fff; }
```

### 4.5 斜杠饰带（区块分隔符）

```css
/* 中文官网标题下方那排 `////`。本站用它做区块之间的呼吸，代替横线 */
.strap {
  flex: 1;
  height: 9px;
  border-radius: 2px;
  background-image: repeating-linear-gradient(
    108deg,
    var(--border-strong) 0 4px,
    transparent 4px 12px
  );
  opacity: 0.85;
}
.strap--on-sky { background-image: repeating-linear-gradient(108deg, rgba(var(--surface-rgb), 0.9) 0 4px, transparent 4px 12px); }
```

### 4.6 Tags / Badges

```css
.tag {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.1rem 0.625rem;
  border-radius: 999px;
  background: var(--accent-soft); color: var(--accent-deep);
  font-size: 0.8125rem; font-weight: 700; white-space: nowrap;
}
.tag--math     { background: rgba(var(--accent-rgb), 0.14); color: var(--accent-deep); }
.tag--english  { background: rgba(91, 200, 245, 0.22);      color: #0B6E96; }
.tag--politics { background: rgba(var(--hoshino-rgb), 0.22); color: var(--hoshino-deep); }
.tag--major    { background: rgba(169, 180, 216, 0.3);      color: #4E5C90; }
.tag--done     { background: rgba(20, 160, 107, 0.16);      color: var(--success); }
.tag--warn     { background: rgba(209, 138, 12, 0.18);      color: var(--warning); }
.tag--error    { background: rgba(220, 76, 106, 0.16);      color: var(--error); }
```

### 4.7 光环（项目签名图形）

```css
/* 倒计时身后缓慢转动的光环 —— 全站唯一的常驻装饰（在天空面板上转为白色） */
.halo {
  position: absolute;
  border-radius: 50%;
  border: 3px solid rgba(var(--surface-rgb), 0.55);
  box-shadow: 0 0 40px rgba(var(--surface-rgb), 0.45), inset 0 0 26px rgba(var(--surface-rgb), 0.28);
  animation: halo-turn 22s linear infinite;
  pointer-events: none;
}
.halo::after {                    /* 环上的缺口，让它不像普通圆圈 */
  content: '';
  position: absolute; inset: -6px;
  border-radius: 50%;
  border: 3px solid transparent;
  border-top-color: transparent;
  border-right-color: rgba(var(--surface-rgb), 0.95);
  transform: rotate(22deg);
}
@keyframes halo-turn { to { transform: rotate(360deg); } }
```

### 4.8 委托单条目

```css
.quest {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center; gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: var(--r-md);
  border: 2px solid transparent;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}
.quest:hover { background: var(--surface-alt); border-color: var(--border); }
.quest[data-done='true'] .quest__title { color: var(--text-tertiary); text-decoration: line-through; text-decoration-color: var(--border-strong); }

.quest__check {
  appearance: none; width: 28px; height: 28px; margin: 0;
  border: 2px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}
.quest__check:hover { border-color: var(--accent); }
.quest__check:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.quest__check:checked {
  background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / 18px no-repeat;
  border-color: var(--accent);
  animation: check-pop 0.28s var(--ease-pop);
}
@keyframes check-pop { 0% { transform: scale(0.82); } 60% { transform: scale(1.14); } 100% { transform: scale(1); } }
```

### 4.9 进度条

```css
.progress { height: 12px; border-radius: 999px; background: var(--surface-sunken); overflow: hidden; }
.progress__fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(96deg, var(--accent-deep), var(--accent) 45%, var(--accent-sky));
  box-shadow: 0 0 12px rgba(var(--accent-rgb), 0.45);
  transition: width 0.5s var(--ease-out);
}
.progress--thin { height: 7px; }
```

### 4.10 台词气泡（星野 / 阿洛娜 / 普拉娜）

```css
.speech {
  position: relative;
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--r-lg) var(--r-lg) var(--r-lg) 6px;
  padding: 0.875rem 1.125rem 1rem;
  font-size: 1rem; line-height: 1.75; color: var(--text);
  box-shadow: var(--sh-subtle);
}
.speech--hoshino { border-color: rgba(var(--hoshino-rgb), 0.55); }
.speech__who { display: block; font-size: 0.8125rem; font-weight: 800; letter-spacing: 0.03em; color: var(--hoshino-deep); margin-bottom: 0.15rem; }
```

---

## 5. Layout Principles

**Container:**
- Max width: `1180px`
- Padding: `clamp(1rem, 4vw, 2rem)`
- Narrow variant（长文本 / 计划说明）: `720px`
- **页脚独立成条**：不再塞进侧栏（上一版侧栏被 5 行声明挤变形），而是页面底部的 `.pagefoot`，压在那条发光云带上。

**Spacing Scale:**
- Section padding: `clamp(1.5rem, 4vw, 2.5rem)`
- 天空面板 padding: `clamp(1.5rem, 4vw, 2.5rem)`
- Component gap: `1rem`（卡内）/ `1.25rem`（卡间，比上一版收紧，减少"空旷感"）
- Card internal padding: `1.125rem 1.25rem`

**Grid:**
```css
.shell {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: clamp(1rem, 3vw, 1.75rem);
  max-width: 1180px;
  margin-inline: auto;
  padding: clamp(1rem, 4vw, 2rem);
  align-items: start;
}
.bento { display: grid; gap: var(--gap); grid-template-columns: repeat(6, minmax(0, 1fr)); }
.bento > .span-6 { grid-column: span 6; }
.bento > .span-4 { grid-column: span 4; }
.bento > .span-3 { grid-column: span 3; }
.bento > .span-2 { grid-column: span 2; }
```

**对齐**：全部**左对齐**。只有倒计时数字与角色台词允许居中——它们是"仪式感"区块，其余一律左对齐以保持仪表盘的可扫读性。

---

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | 无阴影，仅 2px 边框 | 列表条目、次级卡片 |
| Subtle | `0 2px 6px rgba(var(--text-rgb), 0.06)` | 普通卡片（**小半径、贴身**，对应官方站 `0 0 7.5px` 口径） |
| Elevated | `0 10px 26px -10px rgba(var(--accent-rgb), 0.35)` | 悬停卡片、弹窗 |
| Sky | `0 18px 40px -18px rgba(var(--accent-rgb), 0.5)` | 天空面板（投影带主色，像天在发光） |
| Pressed | `0 4px 0 var(--accent-deep)`（实心投影，非模糊） | 主按钮 |

**规则**：阴影永远带蓝调（用 `--accent-rgb` / `--text-rgb`），**禁止中性灰 `rgba(0,0,0,.1)`**——那是通用 SaaS 卡片的特征。弹窗用 `backdrop-filter: blur(10px)`（≤ 14px）。

---

## 7. Animation & Interaction

**Motion Philosophy**: 动效只在"回应你的操作"和"一次负载入场"两处出现；其余一律静止。这是个每天要打开的工具，动效服务于"今天该干什么"的读取速度。
**Tier**: L2

### Dependencies
无第三方库。IntersectionObserver（滚动 reveal）+ Web Animations API（一次性入场编排）+ CSS 关键帧。

### 天空层（氛围，零 GPU 压力的做法）
```css
/* 光柱：斜向条纹，纯 CSS，不占滚动区 */
.bg-ray {
  position: absolute;
  top: -30%; height: 160%;
  width: clamp(80px, 12vw, 190px);
  background: linear-gradient(180deg, rgba(var(--surface-rgb), 0.5), transparent 78%);
  transform: rotate(16deg);
  opacity: 0.5;
  animation: ray-breathe 11s ease-in-out infinite;
}
@keyframes ray-breathe { 0%,100% { opacity: 0.34; } 50% { opacity: 0.62; } }

/* 云带漂移：translate3d，不用 blur */
@keyframes cloud-drift {
  from { transform: translate3d(-3%, 0, 0); }
  to   { transform: translate3d(3%, 0, 0); }
}
```

### Entrance Animation
```css
/* 唯一一次编排式入场：整页错峰浮现，1.1s 内结束 */
@keyframes rise-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.rise { animation: rise-in 0.6s var(--ease-out) both; }
.rise[data-delay='1'] { animation-delay: 0.07s; }
.rise[data-delay='2'] { animation-delay: 0.14s; }
.rise[data-delay='3'] { animation-delay: 0.21s; }
.rise[data-delay='4'] { animation-delay: 0.28s; }
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
```
> 本站在**视图切换**时复用同一套 reveal（切页 → 新视图元素重新 observe），不做视差。理由：这是每天要打开的学习工具，滚动视差会拖慢信息读取。

### Hover & Focus States
- 所有可交互元素：`hover` 有可见变化 + `:focus-visible` 有 3px 强调色描边。
- 卡片 hover：边框转 `--border-hover` + 蓝调阴影 + 可选 SpotlightCard 聚光。
- 键盘可达：全部操作可用 Tab 到达，焦点顺序跟随视觉顺序。

### Signature Moments（6 类，全部落地）
| 类别 | 落点 | 实现 |
|------|------|------|
| Text — Hero | 倒计时数字：`clamp(5rem,17vw,12rem)` 巨型白色数字 + 逐位翻动 | 字号 + 光环 + `digit-roll` |
| Text — Section H2 | 区块标题滚动 reveal 浮现 | `.rise` / IO |
| Text — Body/Label | 星野台词逐字打字机（仅一次，可点击跳过） | `typewriter()` |
| Element | 勾选委托：`check-pop` 弹跳；卡片轮换高光扫过 | CSS 关键帧 |
| Component | Bento 不等大栅格 + SpotlightCard 聚光（不用等大 grid）+ 卡头身份色竖条 | `--card-tone` |
| Background | 天空渐变 + 光柱呼吸 + 云带漂移 + 光环旋转 | 纯 CSS，`translate3d`，无 blur |

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .halo, .bg-ray, .bg-cloud, .mascot--float { animation: none !important; }
  .rise { opacity: 1; transform: none; }
}
```
```js
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

---

## 8. Do's and Don'ts

### Do
- 把每个功能都接到"基沃托斯学园事务局"这套世界观上：委托单、勋章、战力、据点。
- **把胆量花在天空面板这一处**：整页只有它用饱和蓝和纯白文字，其余全部退回白底深字。
- 用 `--accent-soft` 做选中态与进度槽，用 `--accent` 只做真正的主行动点。
- 给每类卡片一个 `--card-tone` 身份色（委托=蓝、专注=天蓝、目标=粉、阶段=紫蓝），靠 4px 竖条区分，不靠整块换色。
- 每个数字都 `tabular-nums`；每处空状态都给一句**可执行的下一步**（不是"暂无数据"）。
- 中文正文行高 ≥ 1.75、字距 `0.02em`、字号 ≥ 15px。
- 移动端把导航折成底部标签栏，触摸目标 ≥ 44×44px。
- 角色色只用在角色自己的形象、台词和对应勋章上。

### Don't
- ❌ 不用纯黑 `#000` 文字；不用中性灰阴影 `rgba(0,0,0,.1)`。
- ❌ 不用暗色电竞底 + 霓虹发光（那不是 BA，是赛博朋克）。
- ❌ **不做等大卡片网格堆满一屏**；列表区用 Bento 不等大布局。
- ❌ **不让每张卡片长得一模一样**：同圆角 + 同白底 + 同边框 + 同阴影 = 表格感，是上一版翻车的主因。
- ❌ 不在每个标题上方加全大写小字眉标；不用 `A · B · C` 式元信息串。
- ❌ 不给每个区块都加 fade-and-slide-up 的悬停动画；动效只回应操作与首次入场。
- ❌ 不用 `filter: blur()` 做移动元素的景深；用 opacity + scale。天空层禁止 blur。
- ❌ 不覆盖大面积滚动区做 `backdrop-filter`；值不超过 14px。
- ❌ 不给按钮文字加 `→`；不用 Emoji 当功能图标（这是学园终端，不是聊天软件）。
- ❌ **不把版权声明塞进侧边导航**——那是页面页脚的活。
- ❌ 不硬编码颜色；不从外部站点热链角色立绘或游戏素材。

---

## 9. Responsive Behavior

**Breakpoints:**
| Name | Width | Key Changes |
|------|-------|-------------|
| Desktop | > 1000px | 左侧固定侧栏 224px + 内容区；Bento 六列栅格；倒计时 `clamp` 上限 12rem |
| Tablet | 641–1000px | 侧栏折叠为顶部两行（品牌行 + 导航行）；Bento 降为单列；天空面板改纵向 |
| Mobile | ≤ 640px | 底部标签栏（安全区适配）；单列堆叠；卡片内边距 1rem；弹窗改全屏抽屉；光柱降到 2 条 |

**Touch Targets:** 最小 44×44px；列表条目行高 ≥ 52px
**Collapsing Strategy:** 导航 → 底部标签栏；Bento → 单列；表格 → 卡片化；长文本 → 折叠 + "展开"

```css
@media (max-width: 1000px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .sidenav { position: static; }
  .bento > * { grid-column: span 6 !important; }
}
@media (max-width: 640px) {
  .shell { padding-bottom: 0; }
  .app { padding-bottom: calc(68px + env(safe-area-inset-bottom)); }
  .tabbar {
    position: fixed; inset: auto 0 0 0;
    display: flex;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--glass);
    backdrop-filter: blur(10px);
    border-top: 2px solid var(--border);
  }
  .countdown__num { font-size: clamp(4rem, 22vw, 6rem); }
  .halo { display: none; }        /* 小屏省掉常驻动画 */
}
/* 防止任何横向溢出 */
html, body { max-width: 100%; overflow-x: clip; }
img, svg, canvas { max-width: 100%; height: auto; }
```

---

## 附：角色形象使用说明（版权护栏）

- 站内角色形象为**本项目自绘的内联 SVG 原创 Q 版造型**，只借用角色的**配色、光环、星形发饰**等通用视觉特征，**不复制任何官方立绘、同人图或游戏内素材**。
- 天空、云带、光柱、斜杠饰带均为**纯 CSS 生成的抽象图形**，不含任何取自官方站的图片或纹理文件。
- 用户可自行替换为自有图片：把文件放入 `public/characters/`，按 `README.md` 的说明替换即可（无需改代码）。
- 站点永久**非商业、无广告、不收费**，页脚保留角色版权归属声明与"非官方"声明。
- 不热链任何第三方图片；不使用官方 Logo 与游戏内 UI 素材。

---

## 附：设计调研记录

| 项 | 内容 |
|----|------|
| 调研脚本 | `scripts/ba-recon.mjs`（Playwright 渲染官方站 → 抓 `getComputedStyle` 频次 → 截图） |
| 产物 | `ba-recon/tokens.json`、`ba-recon/{jp,cn,global}-{hero,2,full}.png` |
| 结论 | 中文官网 `#1189F9` + 2px 蓝边白面板 + 小圆角；日服官网晴空 + 积云 + 细网格纹理 + 青色导航高亮 |
| 本版取向 | 取**日服的天空氛围** + **中文官网的蓝与边框口径**，落在原有"学园终端 + 委托单"母题上 |
