# @harlin97/dsh-ipad-remote

让 iPad 通过**局域网或 Tailscale** 打开桌面端 DeepSeek Harness 的**同一个 Web UI**，并在网络入口加一层自己的 PIN 门禁。

页面不是"长得一样"，而是**就是同一个页面**：插件不重写 UI、不复制组件、不改上游任何文件。

## 它做什么

```
iPad / 手机 / 另一台电脑
   │  https://192.168.x.x:50071/  （或 http://192.168.x.x:50070/）
   ▼
┌──────────────────────────────────────────────┐
│ 本插件的网关（绑 0.0.0.0，HTTP + 可选 HTTPS）│
│  ① PIN 门禁 → 自签会话 cookie                │
│  ② 反代 HTTP + WebSocket 升级                │
│  ③ 代持内层 cookie（设备拿不到）             │
│  ④ 提供增强的 PWA manifest、图标与触控适配层 │
└──────────────────────────────────────────────┘
   │  Host 重写为 127.0.0.1:<harnessPort>
   ▼
Harness webserver（保持默认回环绑定，不动）
```

**Harness 本体不改绑定、不必重启**：开关是运行时的。上游"回环优先"的安全姿态原样保留。

## 安装

插件对 `@deepseek-ai/*` **没有任何运行时依赖**（全部是 type-only import），`lib/` 与 `client/` 都能独立加载；发布包里带着 `assets/` 与 `cordis.patch.yml`（`pnpm pack --dry-run` 已验证）。

### ① Web / TUI profile：一条 `dsh plugin` 命令（推荐给其他人）

```powershell
# 从 npm（发布之后）
dsh plugin --profile web add @harlin97/dsh-ipad-remote

# 或者从本地克隆（今天就能用）
git clone <本仓库> ; cd <本仓库> ; pnpm install ; pnpm build
dsh plugin --profile web add link:<本仓库>\packages\ipad-remote
```

`dsh plugin` 会自动做两件事：写进该 profile 的 `dependencies`，并把它登记进 `dsh.profile.bundles` —— 插件的 `cordis.patch.yml` 因此作为 bundle 层生效，**不需要手工编辑任何 YAML**。实测：`dsh plugin --profile web add link:...` 之后 bundles 变成 `[dsh-base, dsh-web-app, @harlin97/dsh-ipad-remote]`。

### ② 桌面端 App：应用内插件管理器（一键）

`dsh plugin --profile desktop add` **会被上游拒绝**：

```
error: profile "desktop" is managed exclusively by the Electron application
```

（`apps/cli/src/args.ts` 的 `rejectElectronProfile` —— 桌面 profile 只允许 App 自己的载体管理。）所以桌面端走 **设置 → 插件 → 安装**，输入包名即可；本机的 `@linxin666/dsh-client-ui-git-graph`、`@xmanrui/dsh-im` 就是这么装进去的。

### ③ 桌面端 App：home 层 patch（不发布也能用）

```powershell
git clone <本仓库> ; cd <本仓库> ; pnpm install ; pnpm build
.\scripts\install-home-patch.ps1          # 幂等；-Remove 一键还原
```

脚本把托管块写进 `$DSH_HOME/cordis.patch.yml`：自动填本仓库绝对路径、写入前备份成 `.bak-<时间戳>-<随机>`、重复运行只保留一份（连早先手工写入的那套标记也认）、`-Remove` 整段删除还原。装完**重启桌面端**生效。

### 前置条件

- Node ≥ 22.19（`engines`）、pnpm 11
- DSH `>= 0.2.1-alpha.1`（`dsh.engines`）：插件依赖的接缝是 `ctx.webServer.tapIndex`、`ctx.slots`、客户端 bundle 的 lazy-CJS 包裹格式、以及 `directory-picker` 那几行 id —— 这些都随上游版本变化
- 签发 HTTPS 证书需要 `openssl`（装 Git for Windows 即自带）

开发期用 overlay 加载（不碰 profile）：

```powershell
$env:DSH_HOME = "<临时目录>"
cd <harness checkout>
dsh --patch <本仓库>/.run-overlay.yml --profile web --no-open --port 50080
```

> `--patch` 是**启动器级**选项，必须写在 profile 名之前（CLI 开了 `enablePositionalOptions`）。

## 使用

1. 桌面端 Harness 打开**设置 → PWA 远程访问**。
2. 设一个 6 位 PIN，打开开关。
3. 列表里选一个可达地址，用 iPad 扫码或直接打开；输入 PIN。
4. iPad Safari → 分享 → **添加到主屏幕**，得到一个全屏、无地址栏、独立图标的应用。

控制接口（设置卡片走的就是它，也可用 curl）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ipad-remote/api/status` | 状态、可达地址、活跃会话 |
| POST | `/ipad-remote/api/pin` | `{"pin":"123456"}` |
| POST | `/ipad-remote/api/enable` | `{"enabled":true}` |
| POST | `/ipad-remote/api/revoke` | 吊销全部会话 |

## 配置（profile patch，需重启）

| 字段 | 默认 | 说明 |
|---|---|---|
| `bindHost` | `0.0.0.0` | 只接受 `0.0.0.0` 或 `127.0.0.1` |
| `storePath` | `$DSH_HOME/plugins/ipad-remote/config.json` | 运行时状态文件 |
| `maxSessions` | `32` | 并发会话上限 |

运行时可变值（`enabled` / `port` / `tlsPort` / `sessionDays` / `pinHash`）由 store 拥有，改它们不需要改 patch、不需要重启。`tlsPort` 默认 `50071`；旧状态文件没有这个字段时按默认值读，不会被判成损坏。

## 工作区选择器（桌面系统窗口 / 远程不出入口）

目录选择由**插件的浏览器半按页面**决定，而不是交给官方自适应选择器：

- **桌面端**（Electron 壳，页面里有 `__DSH_DIRECTORY_PICKER__` 桥）：插件把自己的目录流程注册进 `ui-workspace` 的两个流程槽位，点「新建工作区」走桥 → **系统文件夹窗口**。
- **远程端**（浏览器，没有桥）：插件**什么都不注册**。`ui-workspace` 以「流程槽位有没有被占用」决定是否渲染「新建工作区」这一项，槽位空着 → **该项根本不出现**，远程只能在已有工作区之间切换。

补丁层因此是「禁用官方自适应 + 只挂浏览后端、不挂任何面」：

```yaml
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true

- insert:
    - id: directory-picker-browse          # 宿主半保留：客户端 workspace 服务依赖 directoryPicker 命名空间存在
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ipad-remote
      name: '@harlin97/dsh-ipad-remote'
```

### 为什么不直接用官方的

- `directory-picker-auto` 在**启动时一次性**判定，一份组合同时服务桌面与所有远程客户端。本机是「回环绑定 + win32」→ 它判 `native`，于是远程点「新建工作区」会把系统窗口开在**这台机器的屏幕上**，手机上什么都没发生。
- 上游 seam 是 `single` 槽位，**不能按连接切后端**（`dsh-host-directory-picker-auto` 的 README 明确写着：按客户端自适应需要 seam 尚未携带的能力通告）。
- 唯一能区分「桌面 / 浏览器」的地方就是页面本身，而 `ui-workspace` 恰好用「槽位是否被占用」决定入口是否出现——于是由我们的客户端半**按页面注册或不注册**，正好得到「本地能加、远程不显示」。

客户端半的判定与注册在 `src/client/picker-flow.ts`：`desktopBridge()` 找不到桥就直接 return，桥在就把一个无渲染的流程占位注册进 `conversation.hero.workspace.directoryFlow` 与 `sidebar.workspaces.directoryFlow`（形状照抄上游原生占位：`open` 上升沿跑一次 pick，回 `onPicked`/`onCancel`/`onError` 之一）。

### 踩过的两条弯路（都在 git 里）

- **弯路一**：把上游浏览面的**两半**都挂上 → 两边都用应用内对话框，桌面失去系统窗口。
- **弯路二**：完全交回官方自适应 → 远程出现「新建工作区」但点下去没反应（系统窗口开在主机屏幕上）。
- **现在的做法**：禁用自适应、只挂浏览后端、不挂任何面；面由插件的浏览器半按页面决定。

验证：`scripts/verify-picker-ui.mjs` 走真实网关链路，远程侧应看到菜单里只有工作区、`new-directory entry: false`。

## 自包含：不碰 DeepSeek Harness 的代码

插件的改动**全部落在本仓库**，加上两个仓库外的运行时接触点，仅此而已：

| 接触点 | 性质 |
|---|---|
| `$DSH_HOME/cordis.patch.yml` 里的托管块 | **注册**（home 层 patch，删掉整段即完全还原）——这是插件被加载的方式，不是改上游 |
| `$DSH_HOME/plugins/ipad-remote/**` | 插件自己的状态文件与 TLS 材料 |

具体到实现层面，这也是设计的一部分：PWA 资产走上游公开的 `ctx.webServer.tapIndex` 钩子注入、触控层由网关内联、目录流程经 `ctx.slots` 注册、设置页是普通的 `settings.section` 槽位——**没有一处修改或复制上游文件**。

> **上游限制不绕过。** `dsh plugin --profile desktop add` 被 `args.ts` 的 `rejectElectronProfile` 拒绝，而要让 CLI 支持桌面 profile 就必须改官方源码——按本项目约束这条路**不走**。桌面端只使用两条不碰源码的途径：应用内插件管理器，或 `scripts/install-home-patch.ps1`（它只写 `$DSH_HOME/cordis.patch.yml`，即你自己的配置）。

想自己核实：

```powershell
# 上游源码 checkout 不该出现与插件相关的改动
git -C <harness checkout> status --porcelain
# 安装目录不该有今天的写入（只有安装当天的文件）
Get-ChildItem '<DSH 安装目录>' -Recurse -File |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-3) } |
  Select-Object LastWriteTime, FullName
```

## 安全模型

**要清楚知道自己在开什么。** 这个 UI 能在你的机器上执行 shell 命令。

- 网络入口只有网关一个面；Harness 本体留在回环。
- 进程 token **永不离开主机**：网关用它换来内层 cookie 自己持有，iPad 只拿到网关自签的会话 cookie。
- PIN：scrypt(N=16384) + `timingSafeEqual` + 按来源地址的指数退避节流。
- 会话 cookie：`HttpOnly` + `SameSite=Lax`；非 GET 的控制请求额外校验同源。
- 线程模型上，网关**有意**把 `Host`/`Origin` 重写为回环 authority 以通过上游围栏——上游自己写明那道围栏"不是鉴权层"（`api-request-trust.ts`），门禁责任在网关的 PIN 会话。
- PIN **只以 scrypt 校验子落盘**；明文仅在设置它的那次运行里留在内存中，供设置卡片显示，进程结束即消失。要完全关掉这个显示，重启即可（或把卡片里那枚「显示」按钮当作唯一的暴露点）。

### 已知限制

1. **HTTPS 是可选的，而且是自签证书。** 不跑 `make-tls.ps1` 时只有明文 HTTP（苹果设备够用，安卓/桌面只能加书签）；跑了之后也不能让公共设备免警告——设备必须先信任本地 CA。而且**明文口始终照常服务**，所以局域网里它依旧可达；要切断只能把 `bindHost` 改成 `127.0.0.1`。
2. **改 PIN 不会自动吊销既有会话**，需要点"吊销全部会话"。
3. 每次 Harness 重启，会话密钥轮换，iPad 需重新输 PIN。
4. Tailscale 分组需要本机已装 Tailscale；没装时该分组为空，不报错。

## 开发

```powershell
pnpm typecheck     # 宿主半 + 浏览器半（两个 tsconfig）
pnpm test          # 170 项
pnpm build         # 宿主半 tsc + 浏览器半 tsdown → lib/ 与 client/
node scripts/build-icons.mjs   # 重新生成主屏图标（零依赖）
```

### 设置卡片（浏览器半）

设置面板里的「PWA 远程访问」一节由 `src/client/` 提供：标题/文案走 locale，数据全部来自上面那张控制接口表。

- 产物是**一个** `client/settings.js`，格式是 Harness 客户端模块系统的 lazy-CJS 工厂包裹（`window.__ModuleLoader__.load({id, factory})`）。它会被内联进这一个文件，所以二维码编码器也是内联的，运行时不依赖任何额外文件。
- **改完 `src/client/` 只需 `pnpm build` + 刷新页面**：bundle 由客户端模块系统按请求供应，页面重载会用新代码重新激活；只有宿主半（`src/*.ts`）的改动才需要重启 Harness。实测 2026-10-06：`pnpm build` 之后，运行中的实例立刻供出含新文案（`pinCurrent`、`PWA 远程访问`）的聚合。
- 二维码用 vendor 的 MIT 编码器（`src/client/vendor/qrcode-generator.ts`，保留原始许可头）编码，渲染成白底黑块的 SVG——**不跟随深色主题**，反色二维码扫不出来。
- 卡片在 iPad 上也能打开（它就在同一个 UI 里）。此时写入走网关转发；关掉开关的响应会先发完再释放监听，所以不会出现"操作失败但其实成功了"。
- **PIN 可以在卡片里查看，但只在本次运行内。** 磁盘上始终只有 scrypt 校验子，插件从不写明文；所以刚设置过的 PIN 会留在进程内存里，卡片用「显示/隐藏」揭示它，重启后则显示「本次运行内还没设置过 PIN」而不是假装知道。代价要说清楚：`GET /ipad-remote/api/status` 会带上这个值（控制面挂在回环 webserver 上，但从网关进来的**已解锁设备**同样够得着），所以任何持有 30 天会话的设备都能读到当前 PIN——这是为了便利有意接受的暴露。

图标是可替换资产：把自己的 PNG 覆盖到 `assets/icon-*.png` 即可，代码不用动。

### 真机验证

`scripts/live-probe.mjs` 对真实 Harness 跑端到端检查（26 项）：控制面、PIN 流程、反代、`tapIndex` 是否真的落到真实 index、manifest、图标、**WebSocket 到真实 `/api/remote.mux` 的升级**，以及**设置卡片的浏览器半是否进了启动图、bundle 能否被服务**。

```powershell
node scripts/live-probe.mjs   # 需要一个用 FRESH DSH_HOME 启动的实例
```

`scripts/verify-settings-ui.mjs` 把上面那条链路在真浏览器（Playwright + 系统 Edge）里走完：解锁 → 输 PIN → 打开设置 → 断言卡片控件存在 → 截图到 `docs/verification/`。它借用 harness checkout 里自带的 Playwright；找不到就打印 SKIP 并以 0 退出。

```powershell
$env:PROBE_DEVICE='http://127.0.0.1:50070'; $env:PROBE_PIN='123456'
node scripts/verify-settings-ui.mjs
```
