# 象五子棋

象棋的走法，五子棋的胜负。移动端优先，支持单人挑战、双人同屏、两种棋盘和八题战术练习，无第三方运行依赖。当前 H5 使用山亭纸面主题；父仓库的 Canvas 入口复用规则、电脑与存档模块。

## 运行与验证

使用 Node.js 24.21.0、pnpm 12.6.0（最低 Node 22.13）。在本目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev                         # http://127.0.0.1:4173，含本地房间 API
pnpm test                        # 规则、电脑、存档、房间、奖励和构建回归
pnpm build                       # dist/，默认关闭旧房间服务入口
node build.js --with-service      # 显式启用独立房间服务入口
```

构建会清理本目录的 `dist/`，拒绝以符号链接作为输出根目录。父仓库须在构建后追加平台配置文件。默认静态包不读取旧房间邀请或凭证，也不请求房间 API；源码开发和 `--with-service` 包仍可运行 `server.js`/`rooms.js` 提供的临时房间。房间是单进程内存状态，服务重启清空；Pages 只托管静态前端。部署变量、跨来源设置与席位恢复见 [独立房间说明](docs/rooms.md)。

浏览器检查需可用的 Playwright/Chromium：

```sh
pnpm test:mobile
node build.js --with-service
node pavilion-check.mjs
```

截图和报告默认进入忽略目录 `.turbo/pavilion/`；`XIANGQI_ARTIFACT_DIR` 可指定输出目录。`XIANGQI_PLAYWRIGHT_MODULE`、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 可指定浏览器工具。`pavilion-check.mjs` 检查旧房间入口的布局与隐藏行为，因此使用有服务构建；真实双人房间浏览器回归在 `mobile-pages-check.mjs`。浏览器仿真不代表手机、Tap 宿主或 Creator 真机验收。

## 源码导航

| 路径 | 用途 |
| --- | --- |
| `index.html`、`app.js`、`style.css` | H5 页面、交互与山亭主题 |
| `game.js`、`local-game.js` | 规则、行动校验、可重放本机存档 |
| `computer.js`、`computer-worker.js` | 概率搜索与浏览器 Worker |
| `computer-hints.js`、`computer-undo.js`、`rewarded-hints.js` | 提示、悔棋与奖励生命周期 |
| `challenges.js` | 八题练习、解题判定和独立进度 |
| `rooms.js`、`server.js` | 可选独立房间 API 与开发服务器 |
| `tap-save.js`、`tap-multiplayer.js` | 合法棋局重放、云档合并与确定性平台好友房规则 |
| `competition-renderer.js` | 联机棋盘与可选触屏平移视口 |
| `pieces.js`、`board-view.js`、`fullscreen.js` | 棋子动效、棋盘视口及兼容工具 |
| `assets/` | 当前发布使用的山亭背景、五子 logo、字体等资源 |
| `*.test.js`、`*-check.mjs`、`build.test.js` | 规则和浏览器验证入口 |
| [docs/README.md](docs/README.md) | 设计、验证、历史与宣传素材索引 |

[规则与练习说明](docs/rules.md)包含走法、棋池、连五判胜、存档与八题目标。电脑当前预算来自 `computer.js`：简易 3 层 / 450 ms、标准 5 层 / 1600 ms、困难 7 层 / 4500 ms；吃子延伸分别为 2 / 3 / 4 层。提示使用 8 层 / 6500 ms / 5 层吃子延伸。迭代加深会在预算内保留完整结果，实际深度因局面与设备而异，不是硬实时保证。

## small-games 集成

父仓库通过 `game-build.local.mjs` 的 `tapServices` 配置启用首页“TapTap 小站”，提供宿主登录、手动云存档、平台排行榜和 SDK 好友房。这些能力不依赖 `backend` 开关；`backend` 控制原有共享竞赛与纪录服务，后端代码继续保留。SDK 好友房是独立休闲对局，不写单机成绩或正式积分。H5 与原生使用不同应用，云档和排行榜分别保存。普通游戏目录的 `pnpm build` 不等同于该渠道服务包。

[Tap 服务说明](https://github.com/coffeeeeffoc/small-games/blob/dev/platforms/taptap/docs/game-services.md) · [好友房规则与验证](https://github.com/coffeeeeffoc/small-games/blob/dev/platforms/taptap/docs/design/multiplayer-2026-10-19/README.md) · [统一构建](https://github.com/coffeeeeffoc/small-games/blob/dev/docs/operations/game-builds.md)

本仓库位于父仓库 `games/submodules/xiangqi-five`。从 small-games 根目录运行：

```sh
pnpm --dir games/submodules/xiangqi-five build
node scripts/competition-build.mjs --game=xiangqi-five
node scripts/competition-build.mjs --native --game=xiangqi-five
```

原生适配器位于父仓库 `platforms/competition/xiangqi-five/native.js`，Cocos 项目位于 `games/minigames/xiangqi-five/`；平台服务和构建配置由父仓库维护。独立子仓库不静态导入父仓库模块；`competition.js` 是父仓库构建生成的服务接入包，不是子仓源码。`competition.test.mjs`、`online-check.mjs` 等共享服务联调脚本需要父仓库环境及隔离测试服务。

保留本仓库 `pnpm-lock.yaml` 用于独立安装，父仓库根锁文件用于 workspace 安装。依赖变更时分别更新；先提交并推送子仓库，再更新父仓库 gitlink。历史 [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md) 与 [RELEASE-REVIEW.md](RELEASE-REVIEW.md) 保留原路径，不能作为当前验收结论。

推送 `main` 的 Pages 工作流会测试、构建和部署；其他分支及 PR 只验证。在线入口：https://coffeeeeffoc.github.io/xiangqi-five/ 。
