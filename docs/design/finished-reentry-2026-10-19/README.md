# 已结束棋局的重新进入与重开

## 行为

- 从首页选择对局模式后点「开始对弈」：上一局已结束时，按当前棋盘、对手及难度设置直接开始新局。
- 从「继续棋局」进入：保留上次棋盘，包括已经结束的棋局；刷新页面后也保持这一行为。
- 已结束棋盘的「本局结束」按钮恢复为可点击的「重新开局」，复用结算页的重开逻辑。棋盘本身保持只读，点击重开后才清空记录。
- 未结束棋局的继续、修改棋盘时的确认、战术练习保持原有行为；好友房间仍须双方同意，棋盘按钮同步显示申请、等待或同意状态。

本次为现有页面的状态修复，沿用已有布局与按钮样式，没有新增页面或重做美术。根因是设置页只按手数判断是否继续，且结算只自动展示一次，返回后棋盘缺少可操作的重开入口。

## 验证

环境：Windows、Node 24.21.0、Playwright Chromium 140.0.7339.186，手机视口与真实浏览器触屏事件；不是物理手机验收。

- 修复前，新增回归用例在 `finished board offers restart` 断言失败，复现按钮禁用。
- `node build.js`、`node mobile-pages-check.mjs`：25 个场景通过，无未捕获浏览器异常。
  - 新增 320×568、390×844 下两种棋盘的胜局返回、继续、刷新、重新开局及相同/不同棋盘开始新局。
  - 实际双客户端 HTTP 房间验证：申请方按钮禁用并显示等待，同意方可从棋盘按钮确认重开，随后双方均可继续落子。
  - 原有未完对局保存、手势取消、暂停电脑思考、战术练习及键盘操作检查通过。
- `node build.js --with-service`、`node pavilion-check.mjs`：22 个场景通过，包含两种棋盘的电脑认输保存、继续旧棋盘和自动开始新局，以及安全区和横屏布局。
  - 首次误用无服务产物，好友入口布局检查不满足前置条件；改用该套件所需的有服务构建后全部通过。
- `node --test --test-concurrency=1 game.test.js rooms.test.js computer.test.js computer-hints.test.js computer-undo.test.js challenges.test.js rewarded-hints.test.js`：51 项通过，0 失败、0 跳过。
- `git diff --check` 通过。

实际截图：

- [9×10 棋盘，320×568](finished-rematch-xiangqi-320x568.png)
- [9×10 棋盘，390×844](finished-rematch-xiangqi-390x844.png)
- [15×15 棋盘，320×568](finished-rematch-gomoku-320x568.png)
- [15×15 棋盘，390×844](finished-rematch-gomoku-390x844.png)

以上为 H5 子模块的本地验证记录；原生小游戏及物理设备未验收。
