# 文档与素材导航

- [父仓库 Tap 小站](https://github.com/coffeeeeffoc/small-games/blob/dev/platforms/taptap/docs/game-services.md)：独立于旧房间后端的登录、云档和榜单。
- [Tap SDK 好友房](https://github.com/coffeeeeffoc/small-games/blob/dev/platforms/taptap/docs/design/multiplayer-2026-10-19/README.md)：同应用双人对局及验证边界。
- [本轮目录与构建整理](qa/2026-10-19-cleanup.md)：删除依据、构建保护与实际验证。
- [独立好友房间部署](rooms.md)：HOST/PORT、跨来源配置、席位与内存服务边界。
- [规则、练习与电脑](rules.md)：当前规则与 H5 操作说明。
- [山亭首页与对局实图](design/home-polish-2026-10-18/README.md)：当前 H5 视觉参考。
- [棋盘预览](design/board-preview-2026-10-18/README.md)、[奖励流程](design/reward-flow-2026-10-18/design.md)：交互设计与当时验证。
- [广告打开阶段超时](design/h5-ad-open-timeout-2026-10-19/README.md)：打开、播放、关闭的生命周期约定。
- `design/` 下日期目录与早期 mobile 文档：版本设计、概念图和历史验收证据；概念不等同实机截图。
- `design/archive/assets/hero-paper.webp`：早期纸面插画，供历史设计文档引用，不进入运行包。
- `marketing/2026-10-18/`：保留发布宣传素材及来源说明，不进入运行包。
- 根目录 `INDEPENDENT-REVIEW.md`、`RELEASE-REVIEW.md`：历史审查原文。

新的运行截图默认进入 `.turbo/pavilion/`，可通过 `XIANGQI_ARTIFACT_DIR` 指定本轮输出目录，不覆盖已有设计证据。父仓库 Canvas/Cocos 设计与验证见其 `platforms/competition/xiangqi-five/docs/design/` 和 `games/minigames/docs/design/`。
