# ShittimLogon 登录场景移植

更新：2026-09-25。本站使用官方 Spine 4.2 运行时实时绘制日／夜 workpage 场景；密码登录成功后播放进入画面，再进入应用。

## 范围与行为

- 登录、注册、找回密码、设置新密码共用教室场景。桌面保留完整 16:9 构图，表单在旁；手机上下排列。
- 按本地时间选择九幕之一：6:00–18:00 白天，其余夜晚。只下载当前需要的房间骨架与贴图；同一实例换房间按需加载。
- workpage 自身包含主角色与同伴，不另外叠加独立 arona / plana 骨架。
- 点击画布或“和阿洛娜打招呼”播放 Touch，播完恢复待机。
- 每次密码认证成功都播放过场。失败不播；退出后再登录重播；已有有效会话刷新直接进入应用。
- 过场采用发行版 enter_splash_day.png / enter_splash.png。约 1.5 秒是本网站的编排参数，未声称与原版精确时长一致。四套骨架都没有独立的 Enter 动画。
- 减少动态效果时绘制静帧，进入反馈缩至 180ms；隐藏标签页暂停待机动画。
- WebGL 不可用、纹理尺寸不支持、素材请求失败或加载超时，回退到同幕缩略图。认证不依赖大素材完成，登录始终可用。
- 无音频自动播放；语音、字幕与 Windows 唤醒后独立前景角色切换不属于这次登录场景接入。

## 已修正的根因

旧交接中的“只剩相机没对准角色”不足以解释问题，以下以代码、PNG 文件头及真实像素验证为准：

| 旧结论／实现 | 核验结果与修正 |
|---|---|
| 修改 SceneStage.camera 可以改变取景 | 原先另建的 OrthoCamera 没被 SceneRenderer 使用。现在直接持有 renderer.camera。 |
| fitTo 的 zoom = 视口／世界范围 | 官方 OrthoCamera.zoom 表示每像素的世界范围，应为世界范围／视口。 |
| 必须搜索角色机位 | 原项目 scene.h 已公开房间矩形 (-1440, 90, 2880, 1620)，中心 (0,900)，按 cover 等比取景。 |
| 原图为 8192²，atlas 声明只有一半 | 源文件实际为 4096²，与声明一致。scale=1 原样复制图集。 |
| 将越界 bounds 的 x/y 强行夹进页面 | 忽略 rotate:90/270，误裁合法区域；offsets 也不该裁切。现在按旋转后的实际占用验证，错误时明确拒绝。 |
| skeletonScale = 2／贴图搬运比例 | 图集分辨率与世界几何独立；默认 skeletonScale=1，降采样只改变图集像素坐标。 |
| clearTracks 足以清掉上一幕 | 附件仍可能保留。每次换幕先 setToSetupPose，再起背景、主角、同伴轨。 |
| 加载 day/night 后全部绘制 | 只绘制当前房间，防止两个房间相互覆盖；独立角色不自动加载。 |
| 贴图应按 PMA 混合 | 原项目 raster.h 明确 PNG 是 straight alpha。ImageBitmap 不预乘，drawSkeleton 使用对应混合方式。 |
| render_still 只能渲染背景 | --character 1 可以保留人物。默认隐藏角色是为生成锁屏壁纸。 |
| 骨骼与附件不在同一世界空间 | 两者同属 Spine 世界空间；附件轮廓可以远离骨骼端点，不能据此判定坐标系不同。 |
| page.screenshot 会缓存未改 DOM 的画面 | 无证据支持。此前调错相机足以解释画面不变。WebGL 单帧取像应在绘制后同步读取。 |

gl.viewport 与画布像素尺寸一致这一要求仍成立。画布 resize 后保留固定世界构图，DPR 上限为 2。

## 依据

- [ShittimLogon 仓库](https://github.com/helloyork/shittim-logon)
- [场景相机与分层](https://github.com/helloyork/shittim-logon/blob/main/adapter/scene.h)
- [贴图与混合约定](https://github.com/helloyork/shittim-logon/blob/main/adapter/raster.h)
- [静帧工具与 --character 开关](https://github.com/helloyork/shittim-logon/blob/main/adapter/render_still.cpp)

场景表采用本机 1.4.1 发行版的实际日志；上游 main 的新版本示例表不替换旧素材对应的九幕配置。

本机源素材：
`D:/下载/ShittimLogon-1.4.1/ShittimLogon-1.4.1/assets`

含角色静帧可这样生成：

```powershell
$root = 'D:/下载/ShittimLogon-1.4.1/ShittimLogon-1.4.1'
& "$root/bin/x64/render_still.exe" --assets "$root/assets" --scene day_1 --character 1 --time 2 --out "$env:TEMP/shittim-day_1.png"
```

## 文件与生命周期

| 文件 | 职责 |
|---|---|
| src/lib/scene-stage.js | 加载、三轨动画、相机、像素绘制、停止与释放 |
| src/components/login-scene.js | 场景 UI、静态兜底、时间切幕、可见性、进入过场 |
| src/views/login.js | 认证成功后 await 过场，再触发进入回调 |
| src/main.js | 过场期间保持登录视图，同步骤通知不重建表单，进入后销毁场景 |
| scripts/stage-shittim.mjs | 可验证的素材搬运，默认保持源分辨率 |
| scripts/verify-shittim-login.mjs | 浏览器认证时序、重播、失败兜底、响应式与生命周期验收 |

SceneStage.load() 可重复调用而不重复初始化；dispose() 中止未完成请求，释放纹理、ImageBitmap、渲染器、上下文与动画帧。登录视图同时释放 ResizeObserver、事件监听器与计时器。

`#scene` 只在 Vite 开发模式开放，生产包不暴露该路由或 window.__scene。历史 scripts/_shittim-probes/ 保留作排查记录，不作为现有实现的依据。

## 重新搬运与验收

```powershell
node scripts/stage-shittim.mjs "D:/下载/ShittimLogon-1.4.1/ShittimLogon-1.4.1/assets" --scale 1
# 可用 --out 指定独立目录验证降采样；不需要更改 skeletonScale。
```

本地认证验收必须指向假后端，不使用真实账号：

```powershell
$env:VITE_SUPABASE_URL='https://fake-project.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='fake-anon-key-for-local-verification-only'
npm run dev -- --port 4330 --strictPort
```

另开终端：

```powershell
$env:SMOKE_URL='http://127.0.0.1:4330/'
npm run verify:shittim
npm run verify:shittim:render
npm run verify:tracks
npm run verify:login
npm run verify:notices
npm test
npm run audit:design
npm run build
```

生产构建前清除当前终端的测试 VITE_SUPABASE_* 环境变量，按项目原有 .env.local 构建。不要把测试后端写入发布包。

## 素材声明

角色与场景来自 ShittimLogon 发行版，非本站原创，版权属于 Nexon / Yostar 及相关原权利人；本站为个人备考自用的非商业、非官方粉丝作品。使用素材不代表从本项目取得其授权。如有版权问题，请联系 2651038380@qq.com。

页脚与设置页声明唯一来源是 src/components/footer.js。随站点保留 Spine Runtimes 原始协议全文：public/licenses/spine-runtimes.txt。
