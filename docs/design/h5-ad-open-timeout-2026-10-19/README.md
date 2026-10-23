# 广告打开成功后停止两层计时

本次替代 `h5-ad-timing-fix-2026-10-18` 包。上一包通过了 12 秒加载＋60 秒播放，但仍有广告层 180 秒播放截止时间和游戏层 226 秒总截止时间。广告结束页停留更久仍会丢失奖励，不能据此宣称完整修复。

用户截图中的 44 秒问题对应 `cops-robbers-realtime/src/taptap-h5-ads.js`，其修复与象五子棋属于不同广告调用路径；没有把截图中的另一包真机成功认定为本包已验收。

## 已合并的隐藏恢复修复

此前宿主在 Window 的 visibilitychange 监听器中调用 provider.dispose()，使完整观看被误判为 dismissed；早期测试从 Document 发出的事件未冒泡，未触达该监听器，造成误通过。现有验证使用会冒泡的事件并检查 Window 接收，保留 pagehide、主动退出与未完整观看的拒绝行为。旧版 12 秒加载加 60 秒播放的墙钟记录与本报告的虚拟时钟案例是不同证据，原记录可从 [10 月 18 日固定提交](https://github.com/coffeeeeffoc/xiangqi-five/tree/fe1c870f3713bb0b19e2ea503a137f86c5c51fa4/docs/design/h5-ad-timing-fix-2026-10-18)追溯。

## 修复

- TapTap H5 仅加载／打开阶段计时，45 秒未成功打开仍失败。
- SDK `show()` Promise 成功后，广告适配器清除自己的计时器，并通过本次请求的 `onShown` 通知游戏层清除外层计时器。Promise 缺失、拒绝或迟到均不当作有效打开成功。
- 正常展示不授予奖励；继续等待 `onClose({isEnded:true})`。未看完、SDK 错误、用户离开当前页面仍不授奖。旧请求的通知不能清掉新请求的计时器。
- 保留首页预加载、可见性恢复交付、首次免费悔棋、中断反馈及本地诊断。诊断版本为 `h5-ad-open-timeout-20261019`，新增 `shown` 阶段。
- 微信／抖音／B 站及原生 Tap 调用继续沿用原有时限；未改动其他游戏的源文件。

SDK 依据：[RewardedVideoAd.show](https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.show/) 返回显示操作结果的 Promise。

## 验证

- `before.txt`：在旧版上重现三条失败回归——广告层、游戏层以及真实宿主组合中，广告打开后停留 10 分钟都提前失败。
- `after.txt`：47 项相关测试全部通过，包含打开超时、SDK 拒绝／缺少 Promise、迟到显示成功／完成回调、预加载、取消、提示／悔棋、原生共享调用及公共消费者端口。
- `host-browser-validation.json`：在本次 H5 包上使用 Chromium 140.0.7339.186，Windows 桌面触屏模拟，320×568、390×844、844×390 全流程通过。
- 长时间案例使用浏览器虚拟时钟推进：加载 12 秒＋结束页停留 10 分钟。期间未提前发奖或失败；模拟完成回调并恢复前台后显示 E1 提示落点。`h5-10min-ad-earned-390.png` 为实际运行截图。此处不是实际等待十分钟，更不是真实广告播放。
- `package-validation.json`：ZIP、解包文件、manifest 和本次修改源码逐文件哈希一致。

## 交付

`outputs/xiangqi-five-h5-ad-open-timeout-2026-10-19/xiangqi-five-taptap-h5-ads-on-service-off.zip`

SHA-256：`cb521b295ccef16c100f347067b402f98d8cd70bb5213478482246385b07e228`。

广告位 1054324，入口 `dist/index.html`，广告开启、服务关闭。保留未提交工作区标记。未上传、未提交或推送、未做 TapTap 真机真实广告验收；没有声称截图中的另一实现已替本包验收。
