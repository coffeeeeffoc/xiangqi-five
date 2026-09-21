# 自由部署 AI Implementation Plan

**Goal:** 不白送棋子，计算攻防与交换，提供具有实际搜索差异的简易、标准、困难三档。

**Architecture:** 在现有 `computer.js` 和 Web Worker 内实现，不引入依赖或模型。共享真实 `canMove` 规则；部署按剩余棋池概率展开，已抽出的棋子按确定结果处理。限时迭代加深，只采用完整搜索结果。

**Tech Stack:** JavaScript modules、Web Worker、Node 内置测试、现有 Playwright。

1. 在 `computer.test.js` 固定两种棋盘的车线送子、回吃陷阱、立即连五与强制防守局面。先运行 `node --test computer.test.js` 复现失败。
2. 在 `computer.js` 增加子力、连线、吃子/回吃评估；所有难度具备基本战术判断。
3. 实现带 Alpha-Beta 剪枝的对抗搜索、棋池概率节点、迭代加深与节点/时间预算；概率分支使用完整窗口，避免平均剪枝边界产生错误期望值。
4. 搜索叶子延伸吃子和强制连五攻防；限制延伸深度。普通候选限制宽度，但立即获胜及强制防守须在截断前检查全部合法行动。
5. 修改 `index.html` 的难度选项、`local-game.js` 存档校验和 README；兼容 practice/standard，新增 hard。沿用 `app.js` 切换、保存和 Worker 生命周期。
6. 用固定局面验证各层作用、概率权重、不修改输入、困难可找到简易看不到的战术，并记录预算与实际完成深度。
7. 运行 `pnpm test`、`pnpm build`、根目录 `pnpm check:games`；扩充 `browser-check.mjs` 检查三个难度真实 Worker 落子、刷新保留、取消旧计算及移动端布局。

不训练模型；不改变规则、房间服务或其他游戏。困难棋力以战术回归和对弈结果为依据，不宣称固定等级分。
