# 棋盘版 Logo 接入

2026-10-18，按最新反馈改用宣传图风格的木质棋盘近景，突出红色五子连线，背景铺满且完全不透明。当前资源为 `assets/five-piece-logo.webp`：512×512、73,440 字节、无透明通道；首页和加载页继续复用同一 URL。PNG 成品、原始生成图、提示词和实际手机尺寸截图见 [宣传素材包说明](../marketing/2026-10-18/README.txt)。内置 image_gen 生成后用 FFmpeg 导出，1024/512 两款 PNG 逐像素确认 alpha=255；`node build.js` 和 `node mobile-pages-check.mjs` 的21项触屏浏览器场景通过，无未捕获页面错误。检查了305/390/844宽的实际首页截图；本轮未做真机或线上发布验收。

以下为此前透明版的接入和验证记录。此前采用用户确认的 [第三版大棋盘](five-piece-logo-v3-large-board.png)，替换第二版。保留原图，当时发布资源为 `assets/five-piece-logo.webp`：512×512、保留透明通道、47,576 字节。首页和加载页使用同一 URL，预加载复用，不额外加载原始大图。按反馈移除左上重复 Logo，首页只保留中央主图。

## 大棋盘版复核

仅更换图片资源，沿用已验证的尺寸和页面逻辑，更新现有游戏构建与 Shell 游戏副本中的同名静态资源，保留其服务配置。Chromium 140.0.7339.186 触屏模拟覆盖 305×568、390×844、844×390：图片解码、加载页、首页、存档后首页均显示正常，无滚动溢出，开始对弈、落子、返回和继续棋局通过。另通过真实 Shell 内嵌游玩、返回与独立 390×844 触屏流程。仅静态资源替换，未重复全量规则测试。

- [当前首页 390×844](logo-large-board-validation/home-390x844.png)
- [当前首页 305×568](logo-large-board-validation/home-305x568.png)
- [当前加载页](logo-large-board-validation/loading-390x844.png)
- [当前横屏首页](logo-large-board-validation/home-844x390.png)
- [当前尺寸与触屏报告](logo-large-board-validation/report.json)
- [当前 Shell 报告](logo-large-board-validation/shell-report.json)

以下为初次接入布局和第二版验证记录，保留供追溯。

## 布局与启动

- 首页：替换原来的“象”字小标和隐藏旧插画，在标题、副标题下展示新 Logo，保留山间棋亭背景与已有设置、分享、开始、继续入口。
- 竖屏：首页宽度 `min(46vw, 21dvh, 184px)`，305×568 时约 119px，390×844 时约 177px。保留至少 24px 的图标下边距，主操作仍靠下排列；存档出现“继续棋局”时不遮挡按钮。
- 横屏：复用原有双列排版，Logo 与标题在左，主操作在右；Logo 不超过 96px。
- 左上角重复小图标已按最新反馈移除，设置入口保持可用。
- 加载页：居中 Logo 最大 144px，显示游戏名和加载状态，遵循安全区。游戏完成初始化后立即移除，不人为设置停留时间。
- 启动期间首页不可交互；脚本加载失败显示“重新加载”。Logo 图片失败不会阻断棋局。加载页与原图形均不增加动画。
- 更新静态构建清单和本地服务器资源白名单。源服务器同时补齐当前页面已有的背景图与提示模块路径，避免本地预览 404。

## 实际验证

Chromium 140.0.7339.186，桌面浏览器触屏模拟，非实体手机或原生小游戏验收。

1. `node build.js --with-service` 后运行 `node pavilion-check.mjs`：22 项通过，覆盖 305×568、375×650/651、390×700/701/740/780/844、844×390、1280×800 和安全区模拟。新增加载中截图、脚本失败重试、图片失败继续游玩，以及首页 Logo 尺寸和按钮间距断言。原联机入口布局用例需要此构建参数。
2. 恢复默认 `node build.js` 后运行 `node mobile-pages-check.mjs`：21 项通过，包括触屏落子、存档恢复、返回、重开、战术练习和结算；房间测试使用该脚本自己的测试服务配置。
3. `pnpm check:dev-mode`：68 款检查、0 问题；`pnpm test:dev-mode`：5 项通过。
4. `DEV_MODE_GAME_IDS=xiangqi-five pnpm test:dev-mode:browser`：10 项通过，覆盖独立、真实 Shell iframe、URL/存储与跨域模式传递。
5. 仅将当前游戏构建复制到已有本地 Shell 构建；`PAGES_GAME_IDS='["xiangqi-five"]' PAGES_SKIP_BUILTINS=1 node apps/shell-web/scripts/pages-smoke.mjs` 通过内嵌游玩、返回目录、390×844 独立触屏游玩。不代表全 Shell 重建或线上 Pages 发布。

已目视对照批准的 Logo，核对加载页、305px/390px 首页与横屏截图；五枚棋子、棋盘和连线保持一致。

最终检查期间并行首页任务加入左上角小图标，并刷新了带托管服务配置的游戏构建。保留该改动，更新 390×844 首页截图；再次运行第 5 项 Shell/独立触屏冒烟通过，并核对 `loading.js`、`app.js`、`style.css` 和 Logo 在当前源码、游戏构建、Shell 游戏副本中逐字节一致。其余布局截图和全流程报告来自前述完整验证，区别仅为左上小图标。

## 截图与记录

- [加载页 390×844](logo-validation/logo-loading-390.png)
- [加载页 305×568](logo-validation/logo-loading-305.png)
- [首页 390×844](logo-validation/pages-390x844-home.png)
- [首页 305×568](logo-validation/pages-305x568-home.png)
- [横屏首页](logo-validation/landscape-844x390-home-xiangqi.png)
- [加载失败重试](logo-validation/logo-loading-retry.png)
- [页面与布局报告](logo-validation/pavilion-report.json)（只保留本次关键截图，完整过程截图在本地 `.turbo/logo-pavilion/`）
- [触屏流程报告](logo-validation/mobile-report.json)
- [开发模式报告](logo-validation/dev-mode-report.json)
- [Shell 与独立入口报告](logo-validation/shell-report.json)

本次为已有游戏素材与启动界面接入，按用户要求进行本地提交，不推送或发布；保留工作区其他既有修改。未修改原生 Canvas 版本，也未进行实体手机/微信等宿主验证。
