# ShittimLogon 登录场景交接

更新：2026-09-25。本轮已修复渲染并接入登录流程；原第 7 轮的诊断结论已重新核验，本文替代旧交接。完整说明见 [shittim-port.md](shittim-port.md)。

## 目标

在考研计划网站登录页实时渲染 ShittimLogon 的日／夜 Spine 场景与角色；每次密码认证成功后播放进入画面，完成后进入应用。保留现有注册、密码恢复、云端同步及非商业素材声明。

## 关键纠正

1. 原相机与渲染器相机不是同一对象，调参没有参与绘制；现已统一为 renderer.camera。
2. 原图真实尺寸为 4096²，并非 8192²。旧图集脚本忽略旋转区域而裁改坐标；现默认原样搬运，缩放时正确验证。
3. 相机标准答案已在上游 scene.h：世界框 (-1440,90,2880,1620)，中心 (0,900)，等比 cover；zoom 是世界范围／像素。
4. workpage 已有全部角色；不用叠加独立 arona/plana。换幕必须恢复 setup pose，且只绘制当前房间。
5. 源 PNG 为 straight alpha；不按 PMA 贴图处理。
6. render_still 支持 --character 1，可输出完整人物；不能把默认背景图当成“原版没有角色”的证据。
7. 不存在独立 Spine Enter 动画；进入画面使用原版 splash，1.5 秒为网站自行定义的过场时间。

## 当前行为

- 桌面左侧完整 16:9 场景，右侧登录表单；手机上下排列。
- 按时间选九幕，按需加载当前日／夜房间，点击可触发 Touch 并回待机。
- 认证失败不播；每次主动登录成功都播；退出再登录重播；有效会话刷新直接进入。
- 过场期间数据通知或 hashchange 不销毁进入流程；旧视图的异步认证不会覆盖新表单。
- WebGL／素材失败、加载超时使用静态图，仍可登录；等待素材过程中也可完成登录。
- 减少动态效果时静帧与 180ms 过渡；后台停止渲染；离开视图释放所有场景资源。
- 开发 #scene 路由仅限 Vite DEV，生产关闭。

## 入口文件

- src/lib/scene-stage.js：场景与生命周期。
- src/components/login-scene.js：UI、降级、过场。
- src/views/login.js / src/main.js：认证与页面切换。
- scripts/stage-shittim.mjs：素材搬运，默认 --scale 1。
- scripts/verify-shittim-login.mjs：浏览器行为验收。
- public/licenses/spine-runtimes.txt：随站点附带的运行时协议。

## 本地运行

测试地址为 http://127.0.0.1:4330/，必须使用假 Supabase 环境变量。配置命令和全部验证命令见 [移植文档](shittim-port.md#重新搬运与验收)。

当前素材源目录：
`D:/下载/ShittimLogon-1.4.1/ShittimLogon-1.4.1/assets`

参考：
[scene.h](https://github.com/helloyork/shittim-logon/blob/main/adapter/scene.h) ·
[raster.h](https://github.com/helloyork/shittim-logon/blob/main/adapter/raster.h) ·
[render_still.cpp](https://github.com/helloyork/shittim-logon/blob/main/adapter/render_still.cpp)

## 验证记录

本地假 Supabase 与正式构建的登录场景浏览器验收均通过；开发模式轨道验收 15/15、九幕实际像素及生命周期脚本通过、旧登录回归 65/65、应用交互 42/42、声明 14/14。九幕与原版缩略图对照图在 `output/shittim/nine-scene-comparison.png`（本地生成物，不入库）；轨道名称断言与截图核验都要保留。

## 范围边界

本轮不包含 Windows 原生登录替换、语音字幕或唤醒时的独立前景角色流程。网站进入动画的精确秒数不是从原版逆向得到的。未自动发布站点。
