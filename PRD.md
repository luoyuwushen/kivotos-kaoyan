# PRD — 基沃托斯作战本部（28考研规划站）

## 产品名称
**基沃托斯作战本部** · Sensei's 28考研指挥终端
（站点简称可自定义，见「设置 → 站点信息」）

## 一句话定位
把 28 考研这场长期作战，做成一份每天打开就知道该干什么的学园委托单。

## 目标用户
- 主力用户：**1 人**（网站主人，28 考研考生，数一/数二/数三 + 英语 + 政治 + 专业课）。
- 次要用户：同为考研人的同学（可自行部署一份）。
- 用户特征：网站制作小白，需要"打开即用、不需要维护后端、不需要花钱"。

## 核心场景
1. **每天早上打开**：一眼看到距初试还有多少天，今天该做哪些委托。
2. **每天学完**：勾掉委托、跑番茄钟、看今天学了多久。
3. **每周回顾**：翻热力图看坚持情况，检查阶段进度是否落后。
4. **每月规划**：把新买的教材目录贴进来，让系统排进日程。
5. **随时查看**：目标院校分数线看板，提醒自己差在哪一科。

## 核心页面（单页应用，视图切换）

| # | 视图 | 内容 |
|---|------|------|
| 1 | **作战本部**（首页） | 倒计时（巨号数字 + 光环）、今日委托单、学习时长、连续天数、星野台词、下一里程碑 |
| 2 | **每日委托** | 按日期查看当天任务；勾选完成；快速添加；从阶段计划自动生成；逾期自动顺延 |
| 3 | **阶段计划** | 基础/强化/冲刺/模考四阶段自动排期；粘贴或上传教材目录 → 自动拆解到周/日；AI 辅助生成（可选） |
| 4 | **专注计时** | 番茄钟（25/45/60 自定义）；正计时；结束后记账；近半年热力图 |
| 5 | **错题本** | 科目分组的知识点清单；掌握程度（生疏/一般/熟练）；标记复习轮次；按遗忘曲线提示 |
| 6 | **目标看板** | 目标院校 + 各科目标分/当前估分/差距；总分进度条；历年分数线参考 |
| 7 | **勋章墙** | 打卡连续天数、累计时长、完成委托数等触发 BA 风格勋章；等级与经验 |
| 8 | **设置** | 考试日期、科目、站点信息、角色挂件开关、数据导出/导入、多设备同步、AI API 配置 |

## 功能清单（按优先级）

### P0 — 必须有
- [x] 28考研初试倒计时（2027-12-26 起算，日期可改；显示剩余天数 / 周数 / 已过去百分比）
- [x] 每日委托单：增删改查、勾选完成、按科目分类、逾期顺延
- [x] 番茄钟 + 学习时长记账、热力图
- [x] 数据本地持久化（localStorage）+ JSON 导出/导入
- [x] 电脑 / 平板 / 手机三端适配

### P1 — 核心增强
- [x] 阶段计划自动排期（基础/强化/冲刺/模考），按剩余天数均摊
- [x] 教材目录导入：粘贴或上传 `.txt` / `.md` / `.csv`，自动解析章节 → 按预估时长排期
- [x] 目标院校分数线看板 + 各科差距
- [x] 勋章墙 + 连续打卡 + 等级经验
- [x] 星野台词系统（每天轮换，可点"再听一句"）
- [x] 阿洛娜 / 普拉娜 挂件

### P2 — 加分项
- [x] AI API 自定义配置：生成阶段计划、从目录推断章节时长（可选，不配置也能用）
- [x] 错题本 / 知识点清单 + 掌握程度
- [x] 多设备同步：JSON 文件导入导出（手动，**已完成**）
- [x] **真正的后端：Supabase 云端同步**（多用户 + 换设备自动同步，**已完成**）
      —— 邮箱登录（魔法链接 / 密码）、一张表 + 行级安全隔离、
      本地改动自动上传、新设备自动拉取、冲突交给人选、可删云端数据。
      代码 `src/lib/cloud.js`、建表 `docs/supabase-schema.sql`、
      界面「设置 → 云端同步」、测试 `npm run test:cloud`（49 项）与 `npm run test:cloud:live`。
- [ ] **可选 GitHub Gist 自动同步**（未实现，且**已被上面的 Supabase 取代**，
      不再计划做；`state.settings.sync` 两个预留字段保留只是为了老备份兼容）
- [x] 深色模式
- [x] 键盘快捷键 / 命令面板
- [x] 自定义角色图（放在 `public/characters/*.png`，由设置里的开关启用）

## 已完成 / 待完成 一览

**已完成（可验收）**：倒计时、每日委托、阶段排期、教材目录导入、番茄钟与热力图、
错题本、目标看板、勋章与等级、星野台词、三角色挂件、AI 接口接入、深色模式、
快捷键与命令面板、JSON 备份与恢复、三端适配、GitHub Pages 自动部署、
**Supabase 云端同步（可选后端：邮箱登录 + 行级安全隔离 + 自动推拉 + 冲突交给人选）**。

**待完成 / 待你处理**：

| 项 | 说明 | 优先级 |
|----|------|--------|
| 初试日期校准 | 默认 2027-12-26 是估算值，教育部通知后需在设置里改正 | 高 |
| 定期备份 | 没配后端时数据只在本地浏览器，建议每周导出一次 JSON | 高 |
| 自定义角色图 | 想换成自己的 Q 版图，需放图片 + 开开关 | 中 |
| 云端后端开通 | 代码已就绪；需要你去 supabase.com 建一个免费项目并执行建表 SQL（约 10 分钟） | 中 |

## 非目标（明确不做）
- ❌ 不做自己运维的服务器：不做自建 Node 服务、不做数据库运维。
      （**例外并已实现**：可选的 Supabase 后端——托管服务，行级安全把数据隔离到每个用户，
      见 `docs/后端与多用户方案.md`。不配置它时，站点仍然是纯静态、零网络请求的。）
- ❌ 不做社交、不做排行榜、不做聊天。
- ❌ 不接入付费服务；所有可选联网功能都可用免费方案实现。
- ❌ 不使用官方游戏素材、不热链第三方图片（见 DESIGN.md 版权护栏）。

## 技术栈
- **构建**：Vite（开发热更新 / 生产打包成静态文件）
- **运行时**：原生 JavaScript ES Modules + 原生 CSS（无 React/Vue，降低小白的理解与维护成本）
- **依赖**：运行时零依赖；`@supabase/supabase-js` 只在**用户真的配置了云端**时才按需加载（单独分包）
- **存储**：localStorage（单机）+ JSON 文件（迁移）+ 可选的 Supabase（多设备 / 多用户）
- **部署**：GitHub Pages，`main` 放源码、`gh-pages` 放构建成品，Source 选 `gh-pages` 分支

## 数据模型（localStorage key: `kivotos-kaoyan-v1`）
```js
{
  version: 1,
  profile:   { nickname, siteName, targetSchool, targetMajor, examDate, subjectSet, dailyGoalMin },
  quests:    [ { id, date, title, subject, estMin, done, doneAt, source, chapterId, createdAt } ],
  phases:    [ { id, name, start, end, goal, color, days } ],
  chapters:  [ { id, subject, book, title, hours, done, order, createdAt } ],
  focus:     [ { id, start, end, minutes, mode, subject, questId } ],
  mistakes:  [ { id, subject, topic, note, level, rounds, createdAt, lastReview, nextReview } ],
  goals:     [ { subject, target, current, full } ],
  scores:    [ { id, year, school, major, total, lines{}, note } ],
  progress:  { streak, bestStreak, lastCheckIn, exp, level },
  medals:    { unlocked: { [id]: ISO时间 } },
  settings:  { theme, mascots{hoshino,arona,plana,speech}, customCharacters,
               aiApi{baseUrl,apiKey,model,enabled}, sync{gistToken,gistId},
               supabaseUrl, supabaseAnon, cloud{autoPush} },
  onboarded: false,
  cloudUpdatedAt: ''   // 本地最后一次改动时间，与云端 updated_at 比对决定推还是拉
}
```
> 满分规则：数学 150 / 英语 100 / 政治 100 / 专业课 150（总分 500，不考数学 350）。
> 满分由 `SUBJECTS[].full` 决定，不接受外部传参，避免被写错。

**云端同步用到的另外两个键**（不在这份 state 里，属于设备本地）：

| 键名 | 存什么 |
|------|--------|
| `kivotos-kaoyan-cloud-cfg-v1` | Supabase 的 Project URL 与 anon key |
| `kivotos-kaoyan-cloud-meta-v1` | 登录的 user_id / 邮箱、上次同步时间、是否做过首次同步 |
| `kivotos-kaoyan-auth` | 登录会话（由 Supabase SDK 写入，`auth.storageKey` 指定） |

## 免费部署方案
| 方案 | 费用 | 难度 | 说明 |
|------|------|------|------|
| **GitHub Pages**（推荐） | 免费 | ★★ | 有 GitHub 账号即可；`git push` 自动重新部署 |
| Vercel / Netlify | 免费 | ★ | 拖拽 dist 文件夹；国内访问一般 |
| Cloudflare Pages | 免费 | ★★ | 国内访问相对快 |
| 本地打开 | 免费 | ★ | 双击 `dist/index.html` 即可，无需联网 |

## 验收标准
- 三端（≥1000 / 641–1000 / ≤640px）无横向溢出，触摸目标 ≥ 44px。
- 无网络也能完整使用（字体走系统栈兜底，图片全部为内联 SVG）。
- 首次打开 30 秒内能知道"今天该做什么"。
- 数据可一键导出、可在另一台设备导入还原。
- 通过 DESIGN.md 第 8 节全部 Don'ts 检查。
