# 当前棋盘版 Logo

2026-10-18，按最新反馈改用宣传图风格的木质棋盘近景，突出红色五子连线，背景铺满且完全不透明。当前资源为 `assets/five-piece-logo.webp`：512×512、73,440 字节、无透明通道；首页和加载页继续复用同一 URL。PNG 成品、原始生成图、提示词和实际手机尺寸截图见 [宣传素材包说明](../marketing/2026-10-18/README.txt)。内置 image_gen 生成后用 FFmpeg 导出，1024/512 两款 PNG 逐像素确认 alpha=255；`node build.js` 和 `node mobile-pages-check.mjs` 的21项触屏浏览器场景通过，无未捕获页面错误。检查了305/390/844宽的实际首页截图；本轮未做真机或线上发布验收。

当前图标展示证据：[305px 首页](../marketing/2026-10-18/source/icon-validation/home-305.png)、[390px 首页](../marketing/2026-10-18/source/icon-validation/home-390.png)、[横屏首页](../marketing/2026-10-18/source/icon-validation/home-844.png)、[验证报告](../marketing/2026-10-18/source/icon-validation/report.json)。

[第三版透明大棋盘原图与生成说明](five-piece-logo-v3-large-board.md)保留为素材来源。已被替代的第一、二版与透明版截图不再放在当前目录；原布局、旧截图和当时验证可从[历史接入记录](https://github.com/coffeeeeffoc/xiangqi-five/blob/fe1c870f3713bb0b19e2ea503a137f86c5c51fa4/docs/design/logo-integration.md)追溯。
