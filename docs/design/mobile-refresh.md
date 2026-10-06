# 2026-10-06 全页面样式优化

先用内置 imagegen 生成并展示 [六屏设计图](mobile-refresh-concept.png)，再实现对应页面。设计图采用暖白纸色、朱红主操作、墨绿辅助色、浅木细框棋盘与轻描边按钮；只把角色表情留在菜单插画和结算装饰中。图中的棋盘与练习筛选为视觉示意，实际实现保留准确的 9×10、15×15 网格及原有练习列表。

首页、玩法选择、单人/同屏准备、对局、对局选项、玩法说明、棋子走法、记录、棋池、战术练习、战术提示、好友房间、重开和结算使用同一套字体、间距、图标与按钮。竖屏为主要方向，横屏保持棋盘右置、必要操作左置；短屏收紧操作区，给棋盘留出空间。没有增加未实现的功能入口。

## 棋子与操作

- 场上棋子只显示居中的汉字，字号随棋格和缩放变化。原有按手机视口计算字号的方式会让 15×15 棋盘文字挤出棋子。
- 自带 `Xiangqi Chess Glyphs` 字体子集，约 4.9 KB，来源 Noto Serif CJK SC Regular 2.003。全部棋种字符覆盖、完整 OFL 1.1 授权和可复现脚本随源码保存，不依赖在线字体服务。
- 主操作改为「抽取棋子」，提示「随机获得一枚，再点空位放置」。已抽取时显示棋子、名称与「点棋盘空位放置」，不能重抽或改为移动。
- 可直接点空位随机落子，也可点己方棋子移动。选中后保留合法绿点、吃子红圈、走法提示和原有动画。
- 待放棋子跨页面、刷新与练习返回仍保持同一枚；保留原有存档、规则与电脑算法。

305×568 的 15×15 棋盘外框为 285px，场上棋子约 15px、字号约 10.9px；较密落点仍可通过放大镜或双指放大操作。普通按钮热区至少 44px。

## 独立与宿主

独立运行时保留完整游戏主页和返回路径。Shell 复用现有同源展示状态协议：进入游戏菜单或对局后隐藏宿主顶栏，返回首页恢复「返回目录」与「分享游戏」。全屏入口在对局选项内；战术链接加载、刷新、浏览器返回和退出全屏保留棋局。

## 实际截图与验证

[实现总览](refresh-implemented-overview.png) · [首页](refresh-home-390x844.png) · [玩法](refresh-modes-390x844.png) · [准备](refresh-setup-computer-390x844.png) · [待放棋子](refresh-game-pending-390x844.png) · [小屏大棋盘](refresh-large-board-pending-305x568.png) · [选项](refresh-tools-390x844.png) · [规则](refresh-rules-390x844.png) · [练习](refresh-challenges-390x844.png) · [练习完成](refresh-practice-solved-390x844.png) · [结算](refresh-result-390x844.png)

Chromium 151 触屏模拟覆盖 305×568、390×844、844×390；原有浏览器回归另覆盖 320px、1280px、较短横屏、鼠标及键盘。验证包括完整棋盘、两阶段抽子、移动/吃子、合法连五、电脑三档、房间同步和断网恢复、待放存档、页面返回、双指取消、练习与结算、字形实际边界及缩放。

- `node build.js`：独立静态制品包含字体与授权。
- `node --test game.test.js rooms.test.js computer.test.js challenges.test.js`：25 项规则、电脑与房间测试。
- `node mobile-pages-check.mjs`：21 个实际触屏场景。
- `node browser-check.mjs` 与 `node challenge-check.mjs`：原有多尺寸、全屏、键盘、八道练习及房间回归。
- `node visual-refresh-check.mjs`：[视觉记录](refresh-validation.json) 与各页截图，检查字体加载、实际字形边界、缩放和按钮热区。
- Shell 两个既有集成测试：64 项；实际 `StandaloneGame` 组件与本游戏制品的 [触屏检查记录](refresh-shell-validation.json) 覆盖首页分享、菜单沉浸、战术深链加载/刷新、返回与实际全屏进退。
- 统一开发模式同步检查、5 项单测与 H5 全屏副本一致性检查。
- [开发模式浏览器记录](refresh-dev-mode-validation.json)：复用原有断言，在默认关闭、URL 开启、存储开启、URL 显式关闭四种状态下检查独立和合集嵌入入口，共 8 项。使用本游戏 `dist` 与生产模式压缩的实际 `StandaloneGame` 组件预览；未执行完整 Shell 路由、目录、Pages 打包或其他游戏的附加检查。

这些记录属于 Chromium 模拟及实际组件预览，没有进行 Android/iOS 真机、原生小游戏平台或跨运营商网络验证；没有将完整合集发布构建作为本地已完成的验证。
