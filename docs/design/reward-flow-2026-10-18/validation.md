# 提示与悔棋验证记录

2026-10-18，Windows、Node、Playwright Chromium 桌面触屏模拟。本次为未提交工作区的本地修订，保留已有美术与分享改动，没有提交、推送、上传或发布线上。

## 修改结果

H5 与原生人机入口使用「获取提示」。先完成广告并返回前台，再运行原有增强搜索；失败信息保留在棋盘附近。观看成功但分析失败，本回合可免费重试。已获得的建议可重看，抽子后可免费更新。

每局一次免费悔棋，使用情况随 v1 存档保存，兼容旧存档。之后只有完整观看回调能撤回；取消、错误、不可用、过期回调均不改棋局，显示「未成功获得悔棋次数，悔棋失败」。撤回红方上一手和黑方应对，恢复原抽子；不能丢弃当前已抽出的棋子来重新抽取。

## 已通过

- 游戏、房间、AI、提示、悔棋、存档与广告测试：47 项；另新增并通过 1 项“隐藏时超时，迟到完成不能覆盖失败”测试。
- 原生游戏、TapTap/H5 广告适配与配置测试：25 项。覆盖关闭回调先于 Show、Show 先于关闭回调、暂停取消、迟到结果、存档恢复、输入冻结。
- 原有手机完整流程：21 个场景，见 `mobile-validation.json`。
- H5 专项：320×568、390×844、844×390，真实 Worker、先广告后分析、未看完反馈、完成后落点标记、首次免费悔棋、刷新后额度保留、广告悔棋成功与失败、实际落子和结算。见 `browser-validation.json`。
- 最终 H5 广告包专项：同样三种尺寸，从实际打包目录加载真实配置与 H5 广告适配，仅替换 Tap SDK 回调，见 `host-browser-validation.json`。
- 原生 Canvas：320、390、430、844 宽度，真实触屏模拟，提示、悔棋、前后台、暂停、帮助、主页、战术选关与棋盘拖动。截图在 `native/xiangqi-five/`，商业广告播放未验证。
- 生产开发者模式：68 款同步检查无差异，5 项规则、象五子棋 10 项浏览器检查通过。见 `dev-mode-validation.json`。
- Shell 的实际 iframe、独立入口、手机操作和返回通过，见 `shell-validation.json`。仅验证象五子棋，不代表全部游戏验证。
- 根目录修改文件 Prettier、两层 Git diff 检查通过；只读复核未发现明确问题。

效果图 `concept.png` 与 H5 实际截图对照：两个按钮同排，最小高度44px；320宽度无横向溢出，横屏保持棋盘和控件同时可见。原生使用48px按钮。`h5-dismissed-*.png`、`h5-undo-failed-*.png` 展示失败反馈，`h5-earned-*.png`、`h5-undo-complete-*.png` 展示成功状态。

## 本地产物

根目录 `outputs/xiangqi-five-reward-flow-2026-10-18/`，启用广告、关闭好友后端：

| 产物 | SHA-256 |
| --- | --- |
| xiangqi-five-taptap-h5-ads-on-service-off.zip | 2d3834d57848b9dc9040952257eb1005132639850433398894e91458f8dd8967 |
| xiangqi-five-taptap-native.zip | a0e7a07df930bf85ce1f4e9a9f985b7bdf0481794de89bdf0e17bd7442f296fa |

H5 ZIP 清单/CRC/SHA与已验证目录一致，关键 JS 与当前源码逐字匹配。原生经过 Cocos Creator 3.8.8、官方 TapTap 转换及 receipt 校验，源码指纹为 `206b95989f9c1c7f591a4a47138dc6ee0c756af4ff71af48d7cfb02914c615ad`。详见产物目录 `validation.json`、`native-build.log`、`native-receipt.json`。

构建矩阵仍保留 buildOnly/sourceDirty 标记：这里记录的是针对本次修改的本地验证，不是准确已提交候选的远端发布门禁结果。未验证真实广告填充、商业播放、真机前后台行为与性能、TapTap 后台方向配置，也未上传或提审。
