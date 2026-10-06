# DSH iPad 远程访问插件设计（dsh-ipad-remote）

- 日期：2026-10-04
- 状态：待评审
- 工作区：`<this repo>`
- 目标 Harness 源码：`<harness checkout>`（v0.2.1-alpha.1）
- 插件契约基线：`@deepseek-ai/dsh-*@0.1.2-alpha.3`、`@deepseek-ai/cordis` peer `^4.0.1` / dev `^4.0.2`

> 本文件引用的路径均以 `<harness checkout>` 为根。注意 `E:\ai\dsh-plugin-base\docs\*` 两份规范里写的是 `D:\ai\deepseek-harness`，那是**过期路径**，本机实际在 `E:\`。

---

## 1. 一句话职责

让 iPad 通过局域网或 Tailscale 打开**桌面端 Harness 的同一个 Web UI**，并在网络入口处增加一层独立的 PIN 门禁。

## 2. 目标

1. iPad 在局域网（`192.168.x`）与 Tailscale（`100.x`，CGNAT `100.64.0.0/10`）下都能打开桌面端 UI。
2. 页面与桌面端**完全一致**——不新增第二套 UI，不复制组件，不改 Harness 前端源码。
3. 网络入口有独立的 PIN 门禁，PIN 之外的凭证（进程 token）**永不离开主机**。
4. iPad 可用"添加到主屏幕"得到一个全屏、无浏览器 chrome、带独立图标的 app 形态。
5. 开关、改 PIN、看地址与二维码，全部在 Harness 设置页里完成，**不需要改 profile patch、不需要重启 Harness**。

## 3. 非目标（明确不做）

- **不做原生 iOS app。** iOS 构建需要 macOS + Xcode，本机是 Windows；分发需要 Apple Developer 账号与审核；且用 SwiftUI 重写 Harness 前端与整套 `/api` RPC 协议，与目标 2 直接冲突。若将来要 native，应作为独立项目在拿到 Mac 之后另立。
- **不改 Harness 上游任何文件**（含 `apps/web/index.html`、`manifest.webmanifest`）。
- **不改会话模型。** "接管桌面端同一会话"与"新建独立会话"由 Harness 现有会话列表天然支持，插件只保证可达与可用。
- **不做 Service Worker / 离线壳。** 会与 Harness 的更新契约冲突，且 HTTP 下无 secure context。留待有 HTTPS 需求时再评估。
- **不实现 TLS。** 见 §8 威胁分析。

## 4. 已核实的上游事实（实现必须以此为准）

| # | 事实 | 源码位置 |
|---|---|---|
| F1 | 桌面端已在 `127.0.0.1:50064` 提供完整 Web UI（`@deepseek-ai/dsh-host-webserver` + `@deepseek-ai/dsh-web-app`）。 | 运行中进程 `DeepSeek Harness.exe`，pid 46848 |
| F2 | 浏览器端传输是 **HTTP + WebSocket**，`/api` 为 ws 多路复用。 | `packages/client/connection/src/api-path.ts:6`、`packages/api/gateway/src/stream-server.ts:1,42-44` |
| F3 | 信任围栏**不是鉴权层**。原文："Network reachability and authentication stay out of scope: binding policy belongs to the webserver config, and this fence is not an auth layer." | `packages/client/connection/src/api-request-trust.ts:12-13` |
| F4 | 围栏对 `/api` 校验 Host/Origin：回环、部署派生的 LAN IP 字面量、或声明的 `trustedHosts`。 | `packages/client/connection/src/api-request-trust.ts:1-14`、`rpc-host.ts:104-107` |
| F5 | 索引鉴权 `authorizeIndex`：`GET /` + 单个 `?token=` 且匹配 → 303 重定向到 `./` 并种下**绑定 authority** 的签名 cookie。 | `packages/client/connection/src/browser-auth.ts:238-256` |
| F6 | `ctx.connection.authenticatedUrl(baseUrl)` 是公开服务方法，能给任意 URL 加上**本进程** token。 | `packages/client/connection/src/rpc-host.ts:120-123` |
| F7 | token 由 `processLaunchToken(ctx.root)` 生成，**每进程一次性**，Harness 重启即变。 | `packages/client/connection/src/browser-auth.ts:194` |
| F8 | `ctx.webServer.tapIndex(transform)` 是公开 API，对每个 index 响应做原始 HTML 变换，返回 disposer。 | `packages/host/webserver/src/index.ts:207-212,336,360` |
| F9 | webserver 的 `host` 只接受 `127.0.0.1`（默认）与 `0.0.0.0`（"deliberate network exposure"）。CLI 层拒绝 `--host 0.0.0.0` 只作用于 `dsh --profile web` 这一条路径。 | `packages/host/webserver/README.md`；`packages/bundle/web-app/src/startup.ts:85-87` |
| F10 | 若把 webserver 绑到 `0.0.0.0`，`resolveLanTrust` 会把所有非 internal IPv4 自动加进 `trustedHosts`；**但只在 boot 时采样一次**。 | `packages/bundle/web-app/src/index.ts:136-143` |
| F11 | 插件包通过 `dsh.bundle.patch` 指向 `cordis.patch.yml` 接入 profile；Web 界面通过同包 `./client` 导出 + `dsh.client` 声明。 | `E:\ai\dsh-plugin-base\docs\plugin-development-conventions.md` §5、`packages/skill-market/package.json` |
| F12 | 当前 iPad 相关 PWA 资产有 4 个缺口：无 `viewport-fit=cover`、无 `apple-touch-icon`、`display` 仅 `fullscreen`（iOS 上 `standalone` 更可靠）、无 `theme_color`/`background_color`。 | `apps/web/index.html:5`、`apps/web/public/manifest.webmanifest` |

**关键推论**：F3 明确说围栏不是鉴权层 → 在它之外自建 PIN 门禁是**补位而非重复**。F6`+`F5 提供了在不接触任何私有 API 的前提下取得内层会话的合法路径。

## 5. 架构

### 5.1 总体形态

```
iPad (Safari / PWA)
   │  http://192.168.x.x:50070/   或   http://100.x.y.z:50070/
   ▼
┌─────────────────────────────────────────────────┐
│ dsh-ipad-remote 网关（本插件，绑 0.0.0.0:50070）│
│  ① PIN 门禁 → 自签会话 cookie                   │
│  ② 反代 HTTP + WebSocket 升级                   │
│  ③ 代持内层 cookie（iPad 拿不到）               │
│  ④ 增强 manifest / 注入 PWA meta                │
└─────────────────────────────────────────────────┘
   │  Host 重写为 127.0.0.1:50064，注入内层 cookie
   ▼
Harness webserver（保持默认 127.0.0.1:50064，不改绑定）
   │
   ▼
现有 Web UI（原样复用）
```

**为什么让网关绑 `0.0.0.0` 而不是让 Harness 本体绑**（F9`+`F10 都支持后者）：

| | Harness 本体绑 0.0.0.0 | 插件网关绑 0.0.0.0（本设计） |
|---|---|---|
| 改 profile patch | 需要 | 不需要 |
| 重启 Harness 才生效 | 需要 | 不需要，运行时开关 |
| 上游回环姿态 | 被放弃 | 原样保留 |
| PIN 门禁位置 | 只能在进程内拦截（路由表已被 `/api` 与 fallback 占满，无干净挂点） | 真正的服务端门禁 |
| token 暴露 | 随二维码/URL 发给 iPad | 永不离开主机 |
| F10 的 boot 采样依赖 | 依赖（Tailscale 晚于 Harness 启动就不生效） | 不依赖 |

### 5.2 组件

```
packages/ipad-remote/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # - insert: [{ id: ipad-remote, name: '@harlin97/dsh-ipad-remote' }]
├── tsconfig.json / tsconfig.build.json / tsconfig.client.json / tsconfig.client.build.json
├── tsdown.config.ts / tsdown.settings.config.ts
├── README.md
├── src/
│   ├── index.ts          # 插件入口：Config、生命周期、路由挂载
│   ├── config.ts         # Config schema + 默认值解析
│   ├── store.ts          # 配置/PIN 校验子持久化（版本化 + 原子写）
│   ├── pin.ts            # scrypt 校验子、常量时间比较、失败计数与退避
│   ├── session.ts        # 网关侧会话 cookie 的签发/校验（HMAC）
│   ├── addresses.ts      # 可达地址枚举与分类（LAN / Tailscale）
│   ├── gateway.ts        # 0.0.0.0 监听 + 鉴权 + HTTP/WS 反代
│   ├── inner-session.ts  # 内层 cookie 获取与刷新（走 F6+F5）
│   ├── unlock-page.ts    # PIN 解锁页（独立 HTML）
│   ├── pwa.ts            # tapIndex 注入 + 增强 manifest + 图标资源
│   └── routes.ts         # /__ipad-remote/api/* 控制面路由
├── assets/
│   ├── icon-180.png / icon-192.png / icon-512.png   # 预渲染，不引 sharp
│   └── unlock.css
├── src/client/
│   ├── index.tsx         # settings.plugin.item 卡片注册
│   └── styles.css
└── test/
    ├── gateway.test.ts / ws-proxy.test.ts / pin.test.ts
    ├── session.test.ts / addresses.test.ts / pwa.test.ts
    └── lifecycle.test.ts
```

**不导出公共 Cordis Service。** 当前消费者只有两个：网关（包内调用）与设置卡片（走 HTTP 路由）。按规范 §2，只有存在多个当前消费者时才抽 Service。

### 5.3 网关鉴权流程

```
GET /                    无会话 → 303 → /__ipad-remote/unlock
GET /__ipad-remote/unlock  返回解锁页（无外部依赖的内联 HTML/CSS）
POST /__ipad-remote/unlock  { pin } → 校验 → 种会话 cookie → 303 → /
                          失败 → 429/401 + 剩余尝试次数，指数退避
POST /__ipad-remote/logout 清会话
其他所有路径               无有效会话 → 303 到解锁页；有 → 反代
```

- 会话 cookie：`HttpOnly`、`SameSite=Lax`、`Path=/`；值为 `HMAC-SHA256(secret, payload)`，payload 含 `issuedAt`/`expiresAt`/`deviceId`。默认有效期 30 天，可配。
- `secret` 每进程生成（网关重启即失效全部会话）。
- 非 GET 请求额外校验 `Origin` 与 Host 同源（借鉴 `skill-market/src/routes.ts:37-46` 的 `sameOrigin`）。
- PIN 为 6 位数字；scrypt 存储；失败 5 次/15 分钟/IP 后指数退避。**常量时间比较**。

### 5.4 内层会话获取（inner-session.ts）

1. `ctx.connection.authenticatedUrl('http://127.0.0.1:' + ctx.webServer.port + '/')` → 取其中 `token` 查询参数（F6`+`F7）。
2. 以 `Host: 127.0.0.1:<dshPort>`、`redirect: 'manual'` 请求该 URL；从 303 响应读取 `Set-Cookie`（F5）。
3. 缓存该内层 cookie，后续每个反代请求注入；**该 cookie 绝不发给浏览器**。
4. 内层返回 401 时重新执行 1–3（覆盖 token 轮换/会话失效）。

> 只使用公开 API。从返回的 URL 里解析 `token` 是当前唯一可行的读取方式——上游没有单独暴露 token getter。此处需在代码注释中标注，并在上游 API 变化时作为首要复查点。

### 5.5 反代规则

**HTTP**
- 目标：`127.0.0.1:<dshPort>`，方法与路径原样。
- 重写：`Host` → `127.0.0.1:<dshPort>`；`Origin` → `http://127.0.0.1:<dshPort>`；`Cookie` → 仅内层 cookie。
- 附加：`X-Forwarded-For` / `X-Forwarded-Proto` / `X-Forwarded-Host`（诊断用）。
- 剥离内层响应的 `Set-Cookie`。
- **响应必须流式 pipe，不得缓冲**（`/api` 有长连接流）。

**WebSocket 升级**
- `server.on('upgrade')`：先验会话；未通过直接销毁 socket。
- 用 `http.request` 带 `Connection: Upgrade`/`Upgrade: websocket` 及原 `Sec-WebSocket-*` 头，监听 `upgrade` 事件拿到内层 socket，然后双向 `pipe`。
- 任一侧 `error`/`close` 都要销毁另一侧；dispose 时必须关闭所有在途 socket。

**这是整个方案的最高风险点**（F2）。必须有专门测试，见 §9。

### 5.6 地址枚举与配对

- `os.networkInterfaces()` 取非 internal 的 IPv4：
  - 跳过 `169.254.0.0/16`（link-local，本机有 3 个无用项）；
  - `100.64.0.0/10` 标为 **Tailscale**；
  - 其余标为 **局域网**（本机当前：`192.168.x.x` WLAN、`192.168.x.x` 以太网）。
- 每个地址的配对 URL = `http://<ip>:<gatewayPort>/`——**不含 token**，因为门禁是 PIN。
- 二维码编码该 URL。
- Tailscale 未安装时（本机现状）该分组显示为空并给出安装提示，不报错。

### 5.7 PWA 增强

通过 `ctx.webServer.tapIndex`（F8）注入，不改上游文件：

| 注入项 | 内容 |
|---|---|
| viewport | 替换为 `width=device-width, initial-scale=1, viewport-fit=cover` |
| apple meta | `apple-mobile-web-app-capable=yes`、`apple-mobile-web-app-status-bar-style=black-translucent`、`apple-mobile-web-app-title=DSH` |
| 图标 | `<link rel="apple-touch-icon" sizes="180x180" href="/__ipad-remote/icon-180.png">` |
| 主题色 | `<meta name="theme-color">` 明暗双份 |

网关另外拦截两个路径，**仅对经网关的访问生效**：
- `/manifest.webmanifest` → `display: "standalone"`、`theme_color`、`background_color`、180/192/512 图标。
- `/__ipad-remote/icon-*.png` → 包内 `assets/` 静态资源。

图标在构建期预渲染为 PNG 并入库，**不引入 `sharp` 作为运行时依赖**。

### 5.8 设置卡片（Client）

在 `settings.plugin.item` 注册一张卡片（**不操作宿主 DOM**，遵循 `harness-design-conventions.md`）：

- 网关开关（运行时启停）
- 监听端口
- PIN 设置/修改（只写不回显，`role('secret')` 语义）
- 可达地址列表（分组：局域网 / Tailscale）+ 每个地址的二维码与复制按钮
- 运行状态：监听中/已停止、当前会话数、最近访问时间
- 活跃会话列表与"吊销全部会话"（改 PIN **不**自动吊销既有会话，见 §8 限制 2）
- 安全提示（见 §8）

二维码在前端生成，QR 库进 `dependencies`。

### 5.9 配置与持久化

**职责切分**（消除"同一个值在两处"的歧义）：

- `Config`（profile patch 层，**需重启才生效**）只放**部署固定值**：`bindHost`（默认 `0.0.0.0`）、`storePath`（默认 `$DSH_HOME/plugins/ipad-remote/config.json`）、安全上限 `maxSessions`。
- **运行时可变值全部由 store 拥有**，保证设置卡片改动无需重启、且不与 patch 层冲突：`enabled`（默认 `false`）、`port`（默认 `50070`）、`sessionDays`（默认 30）、`pinHash`。
- store 持久化到 `storePath`：
  - 带 `version` 字段；未知版本或损坏文件**明确拒绝并报可操作错误**，不静默重置；
  - 原子写（临时文件 + rename）；
  - 权限 `0o600`。
- PIN 存 **scrypt 校验子**（非可恢复密钥），因此放配置文件而非 credentials，理由写进 README。

## 6. 数据流

**首次配对**
1. 桌面端打开 Harness 设置 → iPad 远程访问卡片 → 设 PIN → 打开网关。
2. 卡片列出可达地址，选中一个 → 显示二维码。
3. iPad 扫码 → 解锁页 → 输 PIN → 种会话 cookie → 303 到 `/` → 网关获取内层 cookie → 反代首页 → 解锁成功。
4. iPad Safari "添加到主屏幕" → 全屏 PWA。

**日常使用**
浏览器 → 网关（会话 cookie 有效）→ 重写 Host/Origin + 注入内层 cookie → Harness webserver → 现有 UI。WebSocket 升级同样经网关转发。

**Harness 重启后**
token 变（F7），但网关与 Harness 同进程，网关随之重启；会话 cookie 因 secret 轮换而失效 → iPad 重新输 PIN。内层 cookie 由网关自动重新获取。

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| 端口被占用 | 插件加载失败，报出端口与占用提示；不静默换端口 |
| 未设 PIN 就开启网关 | 拒绝开启，卡片提示先设 PIN |
| 内层会话获取失败 | 网关返回 502 与可读错误页，日志记录原因，不影响桌面端正常使用 |
| WebSocket 升级失败 | 销毁两侧 socket，记录一次告警；不使网关退出 |
| 配置文件损坏/版本未知 | 拒绝加载并报错，保留原文件不覆盖 |
| Tailscale 地址不存在 | 该分组为空 + 安装提示，非错误 |
| 反代目标连接被拒 | 502 + 重试提示（Harness 可能在重启） |

## 8. 安全模型与威胁分析

**信任边界**：网关是唯一面向网络的表面；Harness 本体保持回环。

| 威胁 | 缓解 |
|---|---|
| 局域网内他人扫描到端口 | PIN 门禁；未认证请求只得到解锁页 |
| 二维码/URL 泄露 | 单独泄露无用——令牌不是 URL，PIN 才是门禁 |
| 进程 token 泄露 | 不离开主机；iPad 只持有网关自签会话 cookie |
| PIN 暴力破解 | 6 位 + scrypt + 5 次/15 分钟/IP + 指数退避 + 常量时间比较 |
| CSRF（iPad 浏览器里的恶意页） | `SameSite=Lax` + 非 GET 的 Origin/Host 同源校验 |
| DNS rebinding | 网关只按自身监听接受请求并重写 Host，内层围栏看到的是回环 |
| **明文 HTTP 被同网段嗅探** | **未缓解**——见下方限制 |

**明确记录的限制**：
1. **网关无 TLS**。Token 与 PIN 在无加密的 HTTP 上传输，仅在受信任网络下可接受。用户的 Tailscale 链路本身有 WireGuard 加密，但局域网链路没有。TLS 留待下一迭代（可用 Tailscale 证书或自签 + 信任）。
2. iPad 侧一旦配对，会话 cookie 在有效期内长期有效；改 PIN **不**自动吊销既有会话。卡片需提供"吊销全部会话"操作。
3. 插件绕过了上游围栏的目标（把 Host 重写为回环）。这是**有意的、已记录的**设计：门禁责任完全由网关的 PIN 会话承担。该重写仅发生在网关进程内，不改变上游任何代码。

## 9. 测试策略

按规范 §16 分层，重点覆盖最高风险项：

1. **单元**：`addresses`（分类/跳过 link-local/无 Tailscale）、`pin`（正确/错误/退避/常量时间路径）、`session`（签发/过期/篡改/轮换）、`config`（默认值/schema 拒绝）、`store`（原子写/损坏文件/未知版本）。
2. **反代契约**（核心）：
   - HTTP GET/HEAD/POST 语义、header 重写（Host/Origin/Cookie）、`Set-Cookie` 剥离；
   - **流式响应不被缓冲**（服务端分块写，客户端逐块收到）；
   - **WebSocket 升级转发**：用真实 `ws` 服务端 + 客户端，验证双向消息、二进制帧、ping/pong、任一侧关闭的传播；
   - 未认证的普通请求与 **未认证的 upgrade** 都被拒绝。
3. **生命周期**：挂载 → 使用 → 卸载 → 再挂载；断言端口释放、所有 socket 关闭、tapIndex 注入被撤销、无重复 listener。
4. **组合测试**：通过 Cordis Loader + 真实 patch 启动，证明 `inject` 解析与配置生效；只手工调 `apply()` 不算证明。
5. **产物测试**：从 `lib/` 打包产物加载，验证 `exports`、`dsh.bundle.patch`、`dsh.client` 与 peer 依赖。
6. **端到端验证**（人工 + 脚本）：真实 Harness 上开启网关 → 用第二台设备/本机非回环地址走完整配对 → 验证流式对话与 WebSocket 长连接不中断。

## 10. 已知限制

- 每次 Harness 重启后 iPad 需重新输 PIN（会话 secret 随进程轮换）。
- 无 TLS（§8）。
- Tailscale 链路本机尚未验证——机器未安装 Tailscale；实现按"检测到才启用"，真机验证需先安装。
- 依赖从 `authenticatedUrl()` 返回值解析 token（§5.4）；上游若改变该 API 是首要复查点。
- 网关引入一个额外端口（默认 50070）。

## 11. 实施顺序

1. 仓库脚手架：pnpm workspace、`tsconfig.base.json`、第一个包骨架（照 `dsh-plugin-base` 约定）。
2. `config` + `store` + `pin` + `session` + 单元测试。
3. `gateway` 反代（先 HTTP，后 WebSocket）+ 契约测试。**风险最高，优先做完并测透。**
4. `inner-session`，打通真实 Harness。
5. `unlock-page` + `routes` 控制面。
6. `addresses` + 地址/二维码展示。
7. `pwa` 注入 + manifest 增强 + 图标资产。
8. Client 设置卡片。
9. 真实设备端到端验证 + README + 打包安装验证。

每步完成即 `pnpm typecheck && pnpm build && pnpm test`。
