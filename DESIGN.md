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

本版依据**官方站实测 Token**。取值方式：官方站是 JS SPA，直接抓 HTML 拿不到东西，所以用 Playwright 真实渲染（`scripts/ba-recon.mjs`，产物 `ba-recon/tokens.json` + 截图），并解析其编译后的 CSS bundle 取值。

| 来源 | 实测值 | 本版如何用 |
|------|--------|-----------|
| 中文官网 CSS | 主色 **`#1189F9`**（全站出现 68 次，是最高频的颜色） | 收为本版 `--accent`，替换偏灰的 `#3D9BE9` |
| 中文官网 CSS | 面板 = 白底 + **2px `#1189F9` 实边框** | 卡片边框 1.5px → **2px**，边框带蓝调而非灰调 |
| 中文官网 CSS | **`#A7D8EA`** 是它所有 `box-shadow` 的用色 —— 这才是 BA 真正的"辉光" | 收为 `--glow`，全站阴影/辉光统一走它 |
| 中文官网 CSS | 阴影是"宽、软、蓝"：`0 1px 1px 10px #A7D8EA`、`2px 4px 12px #A7D8EA` | 弃用弥散大投影与中性灰，改为 `--sh-*` 三档蓝调柔光 |
| 中文官网 CSS | "双层描边"**不是**硬投影，是三层叠边：内发丝 + 内白高光 + 外辉光 | 收为 `--frame`，卡片默认用它 |
| 中文官网 CSS | 频道色 `#21BBFF`、进度条渐变 `90deg #54DCFE → #1189F9` | 收为 `--accent-hover` / `.progress__fill` |
| 中文官网 CSS | 动效只有三种时长：`.3s ease`（153 次）、`.5s ease`（144 次）、`1s ease`（168 次），无弹跳曲线；全站唯一的 keyframe 是 `3s ease-in-out infinite` 的漂浮 | 收为 `--t-fast/--t-mid/--t-slow/--t-float`，去掉所有 `cubic-bezier` 回弹 |
| 中文官网 CSS | 列表行 hover **向左滑 8px**，左侧身份条同时填蓝 | 收为委托单条目的 hover |
| 中文官网 CSS | 悬停态是两个字形的**交叉淡入**（叠两层 PNG 切 opacity），不是单属性过渡 | 见第 7 节 |
| 中文官网 CSS | 圆角三档：**8px 标签 / 10–12px 按钮 / 16–20px 卡片 / 24–32px 最外层** | 收敛圆角，不再"什么都是 18px" |
| 日服官网 | 晴空：饱和天蓝 → 白色积云 → 白色光晕；画面上**叠细密十字网格纹理**；导航= 深蓝半透条 + 青色高亮 | 全站背景层 + `--sky-*` + `.bg-hatch` |
| 日服官网 | 大数字走**几何无衬线**（futura-pt-bold），不是圆体 | `--font-num` 改用 Poppins（免费替代） |
| 两站共有 | 深海军蓝文字（`#14273B` / `#001744` / `#224463`）代替纯黑 | 沿用 `--text` 深藏青 |
| 两站共有 | 正式 UI 的蓝是**强调色**，不是大面积底色（官网首页约 90% 是白底 + 深字） | 见下方"天空面板"的特殊处理 |

**本项目的独有母题**：把「每日学习任务」当作基沃托斯发放的**委托单**，把「考研」当作一场长期作战。所有进度条、勾选框、徽章都从"学园事务局"这套世界观里长出来，而不是套通用待办清单。

### 天空面板：一处**有意偏离**官方站口径的决定

官方站证明"蓝是强调色，不是底色"。但这是一个每天要打开的备考工具，首页需要一处**仪式感**，需要"早上推开窗"的感觉——所以本版仍然把首页 Hero 做成整页唯一的饱和天空面板。这是自觉的偏离，代价用对比度审计补回来：

- 面板切成两半 —— **上半是天顶（深，白字）**，**下半化到地平线（浅，深色字）**。
- 面板内所有 13–14px 的小字（`countdown__meta`、`countdown__unit`）自带一层深色贴片 `--chip-bg`，保证它们落在任何天色段上都读得清。
- 天空渐变的色标不是挑好看，是**按 WCAG AA 反推出来的**：白字要 4.5:1 就得压在面板 42% 以内，要 3:1（大字）就得压在 50% 以内。数值见第 2 节注释。
- 审计脚本 `scripts/contrast-audit.mjs` 会沿面板最左一条**确定没有文字**的竖条取背景亮度剖面，再按每个文字元素的纵向位置查表算对比度。**当前 22 项文字全部达到 WCAG AA。**

---

## 2. Color Palette & Roles

```css
:root {
  /* ---- 天空分层 ----
     数值是按对比度审计反推的，不是挑出来的：
     白字要 4.5:1（小字）就得压在面板 42% 以内，
     要 3:1（大字）就得压在 50% 以内，所以渐变必须"深得久一点"。 */
  --sky-1: #1D5C9E;                 /* 天顶 */
  --sky-2: #2B74B8;
  --sky-3: #3F8CCD;
  --sky-4: #A8D6F2;                 /* 地平线 */
  --bg: #F4F9FE;                    /* 落地底色：卡片外的"空气" */
  --cloud: rgba(255, 255, 255, 0.9);/* 云带：页脚那条发光白雾 */

  /* ---- 表面 ---- */
  --surface: #FFFFFF;               /* 主面板 */
  --surface-alt: #E4F1FC;           /* 次级表面 / 交替区块 */
  --surface-hover: #F7FBFF;
  --surface-sunken: #DCEBF9;        /* 凹槽：进度条底、统计块 */

  /* ---- 半透明面板 + 天空面板上的深色贴片 ---- */
  --panel-glass: rgba(255, 255, 255, 0.82);
  --chip-bg: rgba(8, 45, 80, 0.5);          /* 13–14px 小字落在天色上的可读性保障 */
  --strap-bg: rgba(255, 255, 255, 0.72);
  --strap-bd: rgba(255, 255, 255, 0.9);

  /* ---- 边框：一律带蓝调，且比上一版更实 ---- */
  --border: #AFD3EF;
  --border-strong: #7FB8E4;
  --border-hover: #1189F9;

  /* ---- 文字 ---- */
  --text: #123A5C;                  /* 标题、数字：深藏青，替代纯黑 */
  --text-secondary: #3F6B90;
  --text-tertiary: #5C7D9D;         /* 13px 以下要 4.5:1，比上一版压深 */
  --text-foot: #456687;             /* 页脚 12px 小字专用，再深一档 */

  /* ---- 强调色：官方站 #1189F9 起手 ---- */
  --accent: #1189F9;
  --accent-deep: #0A63BE;           /* hover 文字 / 实心投影底 */
  --accent-soft: #D3E9FE;           /* 选中底、进度槽 */
  --accent-hover: #21BBFF;          /* 官方站实测 hover 色 */
  --accent-sky: #54DCFE;            /* 极光青：进度条起点、光环边缘 */
  --accent-ink: #0A3D6B;            /* 压得住的深蓝，用于实心面板/贴片 */
  --glow: #A7D8EA;                  /* 官方站所有 box-shadow 的用色 —— BA 真正的辉光 */

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
  --glow-rgb: 167, 216, 234;
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
- **所有辉光/阴影走 `--glow`（`#A7D8EA`）**，这是官方站实测的阴影用色，也是 BA 最核心的"发光感"来源。
- 面板内的 13–14px 小字一律配 `--chip-bg` 贴片，保证落在任何天色段上都过 4.5:1。

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
/* 环不是"描边圆"，是被透视压扁的发光**环带**，而且环上有断口。
   压扁交给容器（skew + scaleY），旋转交给 ::before，两者互不干扰。 */
.halo {
  position: absolute;
  border-radius: 50%;
  transform: skewX(-16deg) scaleY(0.3);
  opacity: 0.62;              /* 环会横穿数字，压低不透明度：它是氛围，不抢读 */
  pointer-events: none;
  z-index: -1;
}
.halo::before {
  content: '';
  position: absolute; inset: 0;
  border-radius: 50%;
  /* conic 的缺口做出"环上有断口"；mask 把圆盘挖成一条环带 */
  background: conic-gradient(from 0deg,
    rgba(var(--surface-rgb), 0.95) 0deg 58deg,  transparent 58deg 88deg,
    rgba(var(--surface-rgb), 0.95) 88deg 236deg, transparent 236deg 268deg,
    rgba(var(--surface-rgb), 0.95) 268deg 360deg);
  -webkit-mask: radial-gradient(closest-side, transparent 74%, #000 77%, #000 96%, transparent 100%);
          mask: radial-gradient(closest-side, transparent 74%, #000 77%, #000 96%, transparent 100%);
  filter: drop-shadow(0 0 7px rgba(var(--surface-rgb), 0.9))
          drop-shadow(0 0 20px rgba(84, 220, 254, 0.75));
  animation: halo-turn 44s linear infinite;   /* 20–60s/圈，几乎察觉不到，绝不是 loading spinner */
}
@keyframes halo-turn { to { transform: rotate(360deg); } }
```

**尺寸**：基准 190px，第二层 0.68 倍，两层反向旋转（44s / 68s）。
**层叠前提**：环必须挂在一个自成层叠上下文的容器里（`.countdown` 用 `isolation: isolate`），
这样 `z-index: -1` 才能同时做到"盖住天色"和"垫在数字后面"。

> 上一版用了 360px 的大环套住整个数字 —— 那不是 BA 的做法。官方的环是**悬在头顶的小环**：
> 尺寸约等于两行字高、被透视**压扁**成椭圆、环身是发光的带而不是描边、且环上一定有断口。

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

### 4.11 进入作战本部（登录屏）

整站唯一**不套在主外壳里**的一屏：没有侧栏、没有页脚，天空铺满整页。
左栏以 Spine 实时渲染的 16:9 日／夜教室为主景，上方是品牌，下方是压缩后的倒计时和四阶段时间轴；右栏是一块**事务局窗口**——
白纸、**直角**（`--r-sm`，全站唯一的直角面板）、顶上一道斜杠饰带。
表单不压在角色上，手机端改成教室在上、表单在下。场景尚未载入或 WebGL 不可用时显示同幕静态图。
用户选择减少动态效果时教室停在静帧；密码认证成功后进入画面短暂淡入，再切换主应用。

> **为什么右栏不跟 18px 圆角**：差别本身就是信息。整站的卡片都是「应用里的一个模块」，
> 这一块是「从事务局窗口递出来的一张表」。同一套圆角会让它读起来像设置页里的另一张卡。

```css
/* 舞台切换：登录屏和外壳是**同级节点**，谁也不删谁 */
.auth-host { display: none; }
:root[data-stage='auth'] .auth-host { display: block; }
:root[data-stage='auth'] #app > .app { display: none; }
/* 注意是 `#app > .app`：外壳容器类名就叫 .app，与根容器 #app 同名。
   只写 .app 会把 <div id="app"> 一起隐掉 —— 整页空白，而 DOM 检查看起来完全正常。 */
:root[data-stage='auth'] .bg-layer { display: none; }

/* 天色：色标和 4.1 的天空面板同一套，但"起亮"的位置推后到 40% */
.auth__sky {
  position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
  background:
    radial-gradient(78% 42% at 86% 100%, rgba(var(--surface-rgb), 0.62) 0%, transparent 68%),
    linear-gradient(180deg, var(--sky-1) 0%, var(--sky-2) 40%, var(--sky-3) 56%, var(--sky-4) 78%, var(--bg) 95%);
}

/* 左栏文字贴片：比主站的 --chip-bg 更深更实 */
.auth { --auth-chip: rgba(6, 34, 62, 0.82); }
```

**左栏的对比度是「结构性」的，不是靠调天色调出来的。** 这里踩过一次，值得留一笔：

天色层上面还压着光柱、网格纹理和天光（`.bg-bloom--sun` 是 78vw 的白色径向渐变），
它们把天色抬亮一大截 —— 天顶本该是 `#1d5c9e` 的位置，**实测屏幕上量到 `rgb(95,151,203)`**，
白字对比度从 6.6:1 掉到 2.2:1，整栏小字都读不清。

与其和一堆半透明层较劲，不如给文字一个**确定的底**：品牌块、倒计时标签、阶段块
各自带一块深色贴片（`--auth-chip`），字压在上面，对比度就是算得出来的。
倒计时数字改为较紧凑的深色贴片，给教室留出完整构图。

| 元素 | 对比度（浅色 / 深色） |
|------|---------------------|
| 品牌副标题 | 10.08:1 / 15.91:1 |
| 倒计时小标签 | 10.38:1 / 16.05:1 |
| 阶段说明 | 11.39:1 / 16.26:1 |
| 阶段名 | 11.22:1 / 16.26:1 |
| 表单链接 | 5.93:1 / 6.26:1 |
| 倒计时数字 | 深色贴片上白字，验收见登录页浏览器检查 |

审计脚本：`scripts/verify-login.mjs`（第 7 节，共 18 项，浅色深色各 9 项）。

> **审计本身也有两个坑**，都写进脚本注释了：
> ① 此脚本使用 CDP `Page.captureScreenshot` 对最终合成画面取像；
> Spine 动画帧的像素变化另由 `verify-shittim-login.mjs` 实测，不据此推断 Playwright 会缓存截图；
> ② 渐变元素的 `backgroundColor` 是 `rgba(0,0,0,0)`，按计算样式叠出来是白色，
> 白字会被算成 1.06:1。底色必须取**真实像素**（矩形内密采，取出现最多的那个颜色）。
> 顺带修掉了 `test-cloud.mjs` 里对比度公式写反的老问题（`(暗+0.05)/(亮+0.05)`，
> 深字白底会被算成 0.09:1，那三条断言其实一直在用错的值判断）。

**四个步骤共用一块面板**（不跳页、不弹窗）：

| hash | 形态 | 提交后 |
|------|------|--------|
| `#login` | 邮箱 + 密码 | 进应用，并做一次首次对账 |
| `#signup` | 邮箱 + 密码 + 再输一次 | 项目开着 Confirm email 时，回登录屏并留一句话 |
| `#forgot` | 只填邮箱 | 发重置邮件，回登录屏说明 |
| `#reset` | 新密码 + 再输一次 | 改完**退出临时会话**，用新密码正式登一次 |

> `#reset` 为什么要退出重登：改密码用的会话是邮件链接换来的，它是为「改密码」而存在的，
> 不是用户主动登录的结果。让用户拿新密码正式登一次，才能确认新密码真的记住了——
> 否则一旦新密码在别处输错，用户会以为网站坏了。
>
> 这个状态必须单独记（`cloud.js` 的 `passwordRecovery()`）：PKCE 流程下链接里只有 `?code=`，
> 「这次是重置」是服务端兑换 token 时才告诉 SDK 的，看 URL 上的 `type=recovery` 走不通，
> 只能读 `onAuthStateChange` 的事件名。

#### 登录屏的校验与报错

- 报错**落在字段上**（`aria-describedby` 关联，屏幕阅读器会念），不是弹 toast；
  网络 / 邮件额度这类不属于某个字段的错误才进表单级提示区。
- 提交期间按钮换字 + 禁用、所有字段 `readOnly` —— 防连点重复注册、也避免用户
  改了值却发现按的是旧值。
- 焦点顺序：邮箱 →（眼睛）→ 密码 → 主按钮；眼睛是一个真按钮（≥36px 触摸目标），
  睁眼/闭眼两个图标都在 DOM 里，只切 class —— `<svg>` 上的 `hidden` 属性**不生效**，
  用它切显隐会让两个图标同时画出来（实测踩过）。
- 邮箱在步骤之间**带着走**：边打边记，不是只在提交成功时记 ——
  否则「填好邮箱直接点去注册」这个最普通的动作反而会把那行白填。

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
| Frame | `inset 0 0 0 1.5px rgba(accent,.2), inset 0 1px 0 #fff, 0 6px 22px rgba(glow,.5)` | **卡片默认**：官方站的"三层叠边"，不是硬投影 |
| Subtle | `0 2px 10px rgba(glow, .45)` | 次级卡片、状态条 |
| Elevated | `0 4px 18px rgba(glow, .7)` | 悬停卡片、弹窗 |
| Sky | `0 12px 34px -6px rgba(glow, .85)` | 天空面板（投影带辉光色，像天在发光） |
| Pressed | `0 3px 0 var(--accent-deep), 0 6px 16px rgba(accent,.35)` | 主按钮 |

**规则**：阴影永远带蓝调，辉光统一用 `--glow`（`#A7D8EA`，官方站所有 `box-shadow` 的实测用色），**禁止中性灰 `rgba(0,0,0,.1)`**——那是通用 SaaS 卡片的特征，也不是 BA 的做法。官方站实测的阴影是"宽、软、蓝"（`0 1px 1px 10px #A7D8EA`、`2px 4px 12px #A7D8EA`），本版按这个口径统一；"双层描边"用法也证明它**不是**硬偏移投影，而是上面那套 `--frame` 叠边。弹窗用 `backdrop-filter: blur(10px)`（≤ 14px）。

---

## 7. Animation & Interaction

**Motion Philosophy**: 动效只在"回应你的操作"和"一次负载入场"两处出现；其余一律静止。这是个每天要打开的工具，动效服务于"今天该干什么"的读取速度。
**Tier**: L2

### 时长与缓动（对齐官方站实测口径）
```css
:root {
  --t-fast: 0.3s;   /* 默认：hover、颜色、小位移（官方站 153 处） */
  --t-mid: 0.5s;    /* 面板、滑入、淡出（144 处） */
  --t-slow: 1s;     /* 大块布局 / 区块切换（168 处） */
  --t-float: 3s;    /* 全站唯一的常驻 keyframe：3s ease-in-out infinite */
}
```
> **只用 `ease` / `ease-out`，不用 `cubic-bezier` 回弹。** 官方站整套动效系统里没有弹跳曲线，
> 那种"平静"本身就是 BA 气质的一部分。上一版的 `cubic-bezier(0.34,1.56,0.64,1)` 已全部去掉。

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
| Text — Hero | 倒计时数字：`clamp(4.75rem,15vw,10.5rem)` 巨型白色数字 + 逐位翻动 | 字号 + 压扁光环 + `digit-roll` |
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

**登录屏（第 22 节）另有三处断点：**

| Name | Width | Key Changes |
|------|-------|-------------|
| Desktop | > 900px | 左栏倒计时 + 右栏事务局窗口并排，整块垂直居中（`align-content: center`，行只占内容高度） |
| Tablet | ≤ 900px | 天色压成顶部一条（**另一套色标**，60% 处开始化白）；面板落到天色下面，单列 |
| Mobile | ≤ 640px | 光柱全撤；阶段时间轴收掉（天色已盖不住它）；面板内边距 1rem |
| 矮窗口 | height ≤ 760px | 改为从顶部排下来并允许滚动 —— 居中会把输入框顶出裁切边缘 |

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

## 附：素材与版权口径

> **2026 起口径变更**：登录场景移植（见 `docs/shittim-port.md`）之后，站内确实使用了
> 《蔚蓝档案》的官方素材（登录场景的 Spine 骨骼与贴图）。原先「不使用官方立绘与游戏内素材」
> 的说法已不成立，现改为下面这套：**非商业使用 + 明确署名 + 权利人可随时要求下架**。

- **界面图形**：天空、云带、光柱、斜杠饰带、光环均为**纯 CSS 生成的抽象图形**，
  不含任何取自官方站的图片或纹理文件。
- **站内 Q 版角色**（侧栏、首页挂件）为**本项目自绘的内联 SVG**，只借用角色的配色、
  光环、星形发饰等通用视觉特征。
- **登录场景**（`public/shittim/`）使用的是官方 / 同人的角色与场景素材（Spine 导出数据），
  由 `scripts/stage-shittim.mjs` 从 ShittimLogon 发行版搬运而来。
  这些素材的**权利属于其原权利人**（Nexon / Yostar 及相关方），本站不主张任何权利。
- **Spine 运行时**（`@esotericsoftware/spine-core` / `spine-webgl`）© Esoteric Software LLC，
  依 Spine Runtimes License Agreement 使用；页脚保留其版权声明（该协议要求随再分发附带）。
- 用户可自行替换 Q 版形象：把文件放入 `public/characters/`，按 `README.md` 的说明替换即可。
- 站点**非商业、无广告、不收费**；页脚保留角色版权归属声明与「非官方」声明。
- **侵权处理**：如权利人不希望素材出现在本站，请联系 **2651038380@qq.com**，我们会立即移除。
- 不热链任何第三方图片——素材一律随站点自托管。

---

## 附：设计调研记录

| 项 | 内容 |
|----|------|
| 调研脚本 | `scripts/ba-recon.mjs`（Playwright 渲染官方站 → 抓 `getComputedStyle` 频次 → 截图） |
| 产物 | `ba-recon/tokens.json`、`ba-recon/{jp,cn,global}-{hero,2,full}.png` |
| 结论 | 中文官网 `#1189F9` + 2px 蓝边白面板 + 小圆角；日服官网晴空 + 积云 + 细网格纹理 + 青色导航高亮 |
| 本版取向 | 取**日服的天空氛围** + **中文官网的蓝与边框口径**，落在原有"学园终端 + 委托单"母题上 |
