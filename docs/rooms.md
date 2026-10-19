# 独立好友房间服务

`server.js` 与 `rooms.js` 保留为可独立运行的 1v1 邀请房间。它与父仓库的共享账号/排位服务、Tap SDK 好友房分别使用独立入口和协议；默认静态构建关闭此房间功能，源码开发或 `node build.js --with-service` 才开放。

## 启动与部署

在子仓库目录运行 `node server.js`，默认监听 `127.0.0.1:4173`，同时提供源码网页与 `/api/rooms` API。局域网试玩或反向代理部署可指定：

```sh
HOST=0.0.0.0 PORT=4173 node server.js
```

同一 Wi-Fi 的手机应使用电脑局域网地址打开页面后创建房间，邀请链接才指向可访问的主机。部署到公网时由 HTTPS 反向代理转发至上述端口。

GitHub Pages 只能托管静态前端，不能运行 Node 房间 API。需要前后端分离时：

```sh
node build.js --with-service
# 将 dist/ 部署到静态站点；另在后端主机运行：
HOST=0.0.0.0 PORT=4173 FRONTEND_ORIGIN=https://username.github.io node server.js
```

`FRONTEND_ORIGIN` 必须是前端精确来源（协议、域名及可选端口，不含仓库路径）。同源部署无需设置；任意未获允许的来源不能创建房间。页面可通过 `?server=https://backend.example` 指定 API 服务，也可使用“自建房间设置”；邀请链接会携带服务地址。页面首先检查 `/api/rooms/health`，服务不可用时阻止创建/加入。

## 席位、状态与限制

创建者执红，加入者执黑。服务端抽子、校验版本/行动并判胜，客户端约每秒同步；过期操作被拒绝，断网时锁定行动后重试。重开须双方同意，任何一方可取消。

普通本机棋局放在 `localStorage`，进入房间前保留、退出后恢复。席位凭证放在当前标签页 `sessionStorage`，刷新可恢复；邀请链接不携带该凭证。返回本机棋局会放弃席位，原邀请码不能找回已占用席位，可新建房间。

房间是单进程内存状态，最多 100 个，闲置一小时或创建满一天后过期，服务重启清空。当前没有持久化、多实例共享、账号、自动匹配或 2v2。`node --test rooms.test.js` 通过真实 HTTP 验证身份、版本冲突、服务端行动及双方重开。
