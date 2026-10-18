# TapTap H5 完整观看后奖励丢失修复

用户确认问题发生于 TapTap H5。此次只改 H5 宿主的取消条件，不改棋力、界面、悔棋规则或原生适配。

## 已复现的原因

上一版游戏控制器已保留隐藏期间的广告请求，但打包注入的 `platforms/h5/rewarded-host.js` 仍在 Window 的 `visibilitychange` 监听器中对隐藏页面执行 `provider.dispose()`。广告弹出使页面隐藏，请求先返回 dismissed；之后 SDK 的完整观看关闭回调被当作过期结果忽略。

上一轮浏览器用例从 Document 派发默认不冒泡的合成事件，没有触达 Window 的这层监听器，因此产生错误的通过结果。本次让事件冒泡，并断言 Window 确实接收四次隐藏/恢复事件。

## 先失败，再修复，再验证

- `host-before.txt`：使用真实宿主模块与真实游戏授权控制器，完整观看的预期 completed 实际为 dismissed。初始独立测试随后合入 `scripts/h5-ad-config.test.mjs`，由现有增量检查执行。
- `browser-before.txt`：用上一版已打包 H5、真实配置/宿主/Worker、模拟 Tap SDK 完整观看，实际没有提示高亮并显示「广告未看完，提示未成功生成」。复现源为 `outputs/xiangqi-five-reward-flow-2026-10-18/`。
- 修复仅删除宿主在 visibilitychange 时取消广告的监听器。保留 pagehide、游戏主动取消、超时、错误与未完整观看的拒绝行为；奖励仍依赖完整观看回调。
- `host-after.txt`：11 项广告配置、宿主、提供方测试通过。宿主用例覆盖关闭先于返回、返回先于关闭、未看完、主动取消、pagehide。
- `browser-after.txt` / `host-browser-validation.json`：在本次最终包目录上，320×568、390×844、844×390 的提示、广告中断反馈、完成后高亮、首次免费悔棋、保存额度、广告悔棋成功/失败、暂停后过期回调均通过。
- 两个根目录修改文件 Prettier 和两层 Git diff 检查通过。无临时生产调试代码。

SDK 完整观看字段对照 [TapTap 官方 onClose 文档](https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.onClose/)，没有放宽为“关闭即奖励”。

## 修复包

`outputs/xiangqi-five-h5-ad-host-fix-2026-10-18/xiangqi-five-taptap-h5-ads-on-service-off.zip`

SHA-256：`135880327eb2bd60f767a6bc828095f2b5826abf71e76fa216c6dbe2b25fd02e`

ZIP 清单、CRC、SHA 与已验证目录一致；其中宿主 JS 与当前源码一致。与上一版包比较，唯一改变的文件是 `rewarded-host.js`。广告开启、好友后端关闭；旧包保留。

本次已验证本地可确定复现的问题及修复，仍是桌面 Chromium 触屏模拟、SDK 回调替身，没有真实手机或商业广告播放证据。包未上传、提审或发布；需要用本次 H5 修复包替换上一版后进行平台复验。原生包本次未重建。
